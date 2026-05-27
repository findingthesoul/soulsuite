// POST /api/host-bookings
//
// Host-initiated booking. The signed-in host picks a meeting type + slot + invitee instead of
// the invitee self-serving via the public link. Three behaviours by MT shape:
//
//   - Free MT: immediate booking, finalize() runs the standard Google event + confirmation
//     email path.
//   - Paid Stripe MT: PENDING booking + Stripe Checkout session, the invitee gets an email
//     with the payment link. Existing webhook finalises on payment.completed.
//   - Paid Invoice MT: blocked in v1 (the invoice flow needs billing details that we can't
//     reasonably ask the host to enter on the invitee's behalf — drop into the public link).
//
// Require-approval is bypassed: the host *is* the approver, no point asking themselves.
// Slot availability is re-checked server-side via the same freebusy path the public POST uses
// so two host-initiated bookings on the same slot can't both succeed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { effectiveWorkingHours } from "@/lib/availability";
import { finalizeBooking } from "@/lib/bookings/finalize";
import {
  appUrl,
  bookingConfirmationTemplate,
  hostInitiatedFreeTemplate,
  hostInitiatedInvoiceTemplate,
  hostInitiatedPaymentTemplate,
  sendEmailAfterResponse,
} from "@/lib/email";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { getEmailLogoUrl } from "@/lib/branding";
import { stripeClient, isStripeConfigured, formatPrice } from "@/lib/stripe/client";
import { publicEnv } from "@/lib/env";

const inviteeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200),
});

const bodySchema = z.object({
  meetingTypeId: z.string().min(1),
  startsAt: z.string().datetime(),
  // Single-invitee shape for back-compat with older clients. New clients send `invitees`.
  inviteeName: z.string().trim().min(1).max(120).optional(),
  inviteeEmail: z.string().email().max(200).optional(),
  invitees: z.array(inviteeSchema).min(1).max(50).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  // Only meaningful for paid (Stripe) MTs. When true, the host wants the invitee to pay —
  // send a Stripe Checkout link. When false (default), book as complimentary: no payment
  // collected, immediate finalize. Lets hosts comp meetings for VIPs / friends / team without
  // having to flip the MT itself to free.
  chargeInvitee: z.boolean().optional().default(false),
  // Only meaningful when chargeInvitee is true. When false (default), the reservation goes
  // through immediately (Google event + standard confirmation email) and the payment /
  // invoice-details ask is sent as a follow-up — the meeting is not held hostage to payment.
  // When true, we revert to the strict flow: no Google event until payment lands (Stripe) or
  // until the billing form is submitted (Invoice).
  requirePayment: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new NextResponse(
      `${issue?.path?.join(".") ?? "body"}: ${issue?.message ?? "invalid"}`,
      { status: 400 },
    );
  }
  const body = parsed.data;
  const startsAt = new Date(body.startsAt);
  if (startsAt.getTime() <= Date.now()) {
    return new NextResponse("Pick a time in the future.", { status: 400 });
  }

  // Normalise invitee shape — accept either the legacy single-invitee fields or the new
  // `invitees` array. After this block, `invitees` is the canonical list (>= 1).
  const invitees: { name: string; email: string }[] = body.invitees && body.invitees.length > 0
    ? body.invitees
    : body.inviteeName && body.inviteeEmail
      ? [{ name: body.inviteeName, email: body.inviteeEmail }]
      : [];
  if (invitees.length === 0) {
    return new NextResponse("Provide at least one invitee.", { status: 400 });
  }
  // Dedupe by lowercased email — two rows for the same person on the same slot is a footgun.
  const seenEmails = new Set<string>();
  for (const inv of invitees) {
    const lower = inv.email.toLowerCase();
    if (seenEmails.has(lower)) {
      return new NextResponse(`Duplicate invitee email: ${inv.email}`, { status: 400 });
    }
    seenEmails.add(lower);
  }

  const meetingType = await prisma.meetingType.findUnique({
    where: { id: body.meetingTypeId },
    include: { intakeForm: true },
  });
  if (!meetingType || !meetingType.isActive) {
    return new NextResponse("Meeting type not found.", { status: 404 });
  }

  // Caller must own this MT (personal) or be on its project.
  let hostId: string;
  if (meetingType.scope === "PERSONAL") {
    if (meetingType.hostId !== caller.id) {
      return new NextResponse("You don't own this meeting type.", { status: 403 });
    }
    hostId = caller.id;
  } else {
    if (!meetingType.projectId) return new NextResponse("Misconfigured meeting type.", { status: 500 });
    const member = await prisma.projectMember.findUnique({
      where: { projectId_hostId: { projectId: meetingType.projectId, hostId: caller.id } },
    });
    if (!member) {
      return new NextResponse("You're not on this project.", { status: 403 });
    }
    // For project MTs we assign to the caller — they're the one initiating, even if the MT
    // is round-robin or collective. The booking row's hostId determines whose calendar holds
    // the event; round-robin fairness doesn't apply to host-initiated bookings.
    hostId = caller.id;
  }

  // Invoice-method paid MTs ARE supported via a deferred-billing flow: we create the booking
  // row with an `invoiceDetailsToken`, email the invitee a link to /billing/[id]?token=…,
  // and finalise (Google event + standard confirmation) when they submit. Multi-invitee +
  // INVOICE is rejected below because billing details are per-person, not per-meeting.
  if (meetingType.paymentMethod === "ADYEN") {
    return new NextResponse(
      "Adyen meeting types can't be host-initiated.",
      { status: 400 },
    );
  }
  // Host-initiated bookings on a require-approval MT auto-approve — the host IS the approver.
  // The actual booking row is created with status=CONFIRMED below; no PENDING_APPROVAL row.

  // Multi-invitee cap: the MT's maxInvitees controls how many people can join the same slot.
  // Default MT shape is 1 (= 1:1 meeting); >1 = group meeting. Stay within whatever the MT
  // permits so the dashboard's capacity logic stays consistent.
  if (invitees.length > meetingType.maxInvitees) {
    return new NextResponse(
      `This meeting type allows at most ${meetingType.maxInvitees} invitee${meetingType.maxInvitees === 1 ? "" : "s"} per slot.`,
      { status: 400 },
    );
  }

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: { calendars: true },
  });
  if (!host) return new NextResponse("Host not found.", { status: 404 });
  if (!host.googleRefreshToken) {
    return new NextResponse("Your Google Calendar isn't connected. Reconnect under Settings → Calendars.", { status: 503 });
  }
  if (!host.calendars.some((c) => c.role === "WRITE_TARGET")) {
    return new NextResponse("You don't have a write-target calendar selected.", { status: 400 });
  }

  const endsAt = new Date(startsAt.getTime() + meetingType.durationMinutes * 60_000);

  // Re-validate the slot against the host's fresh freebusy + working hours. Prevents two host-
  // initiated bookings on the same slot, and keeps the host from accidentally double-booking
  // themselves over an existing event the form didn't know about.
  const margin = (Math.max(meetingType.bufferBeforeMinutes, meetingType.bufferAfterMinutes) + 60) * 60_000;
  const range = { from: new Date(startsAt.getTime() - margin), to: new Date(endsAt.getTime() + margin) };
  const busy = await fetchHostBusy(host, range, meetingType);
  const slots = computeAvailableSlots({
    host: {
      timezone: host.timezone,
      workingHours: effectiveWorkingHours(meetingType, host, undefined),
    },
    meetingType: {
      durationMinutes: meetingType.durationMinutes,
      bufferBeforeMinutes: meetingType.bufferBeforeMinutes,
      bufferAfterMinutes: meetingType.bufferAfterMinutes,
      minNoticeMinutes: meetingType.minNoticeMinutes,
      maxAdvanceDays: meetingType.maxAdvanceDays,
    },
    range,
    busy,
  });
  const free = slots.some(
    (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
  );
  if (!free) {
    return new NextResponse(
      "That slot isn't available on your calendar (busy, outside working hours, or past the booking window).",
      { status: 409 },
    );
  }

  // Idempotency key — same shape as public POST so retries collide. Per invitee so each row
  // in a multi-invitee booking has its own unique requestId. Arrow form (not a function
  // declaration) so the closure captures the narrowed-non-null types of meetingType + host.
  const requestIdForInvitee = (email: string): string =>
    `hb-${createHash("sha256")
      .update(`${meetingType.id}:${host.id}:${startsAt.toISOString()}:${email.toLowerCase()}:host-initiated`)
      .digest("hex")
      .slice(0, 32)}`;

  const isPaid = (meetingType.priceCents ?? 0) > 0;
  // Three-way decision for paid MTs:
  //   1. priced + chargeInvitee=true + Stripe rail  → Stripe checkout
  //   2. priced + chargeInvitee=true + INVOICE rail → deferred-billing link
  //   3. priced + complimentary                     → free branch (paymentStatus NOT_REQUIRED)
  const willCharge = isPaid && body.chargeInvitee === true;
  const willInvoice = willCharge && meetingType.paymentMethod === "INVOICE";
  const willStripe = willCharge && meetingType.paymentMethod === "STRIPE";

  // Per-invitee billing means we can't bundle multi-invitee with INVOICE. Stripe has the same
  // constraint for the same reason — punt to the public link in either case.
  if (willCharge && invitees.length > 1) {
    return new NextResponse(
      "Charging is only supported for a single invitee per booking. Untick PAID for the rest, or send them the public booking link.",
      { status: 400 },
    );
  }
  const noteAnswer =
    body.note && body.note.length > 0
      ? ({ __hostNote: body.note } as Prisma.InputJsonValue)
      : undefined;

  // ── INVOICE branch (host-initiated) ──
  // Two sub-flows controlled by requirePayment:
  //   - default (requirePayment=false): create + finalize immediately so the calendar invite
  //     goes out. paymentStatus = INVOICE_PENDING (host still owes the invoitee an invoice).
  //     Invitee gets a follow-up email with the billing-details link. The submission only
  //     records billing details + (for SOUL_SUITE) fires the invoice.
  //   - strict (requirePayment=true): no Google event until the billing form is submitted.
  //     paymentStatus = PENDING. Submission flips to INVOICE_PENDING + runs finalize.
  if (willInvoice) {
    const sole = invitees[0];
    const requestId = requestIdForInvitee(sole.email);
    const invoiceDetailsToken = randomBytes(24).toString("hex");
    const strict = body.requirePayment === true;
    let pendingId: string;
    try {
      const created = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: sole.email,
          inviteeName: sole.name,
          inviteeAnswers: noteAnswer,
          startsAt,
          endsAt,
          requestId,
          status: "CONFIRMED",
          paymentMethod: "INVOICE",
          // Strict: PENDING blocks the dashboard from showing a Google event; submit-flow
          // promotes to INVOICE_PENDING. Default: jump straight to INVOICE_PENDING because
          // the meeting is happening regardless of billing-form completion.
          paymentStatus: strict ? "PENDING" : "INVOICE_PENDING",
          invoiceDetailsToken,
        },
      });
      pendingId = created.id;
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await prisma.booking.findUnique({ where: { requestId } });
        if (existing) {
          return NextResponse.json({ id: existing.id, alreadyExists: true });
        }
      }
      throw err;
    }

    // Default flow: finalise now so the calendar invite goes out alongside the billing ask.
    // finalizeBooking is idempotent on googleEventId, so a future submit-invoice-details call
    // that also tries to finalize will simply no-op.
    if (!strict) {
      const result = await finalizeBooking({
        bookingId: pendingId,
        hostId: host.id,
        collectiveCoHostIds: [],
        inviteeTimezone: host.timezone,
      });
      if (!result.ok) {
        return new NextResponse(result.message, { status: result.status });
      }
    }

    const logoUrl = await getEmailLogoUrl();
    const baseUrl = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    const billingFormUrl = `${baseUrl}/billing/${pendingId}?token=${invoiceDetailsToken}`;
    const tmpl = hostInitiatedInvoiceTemplate({
      hostName: host.name,
      meetingTypeName: meetingType.name,
      startsAtIso: startsAt.toISOString(),
      endsAtIso: endsAt.toISOString(),
      inviteeName: sole.name,
      formattedPrice: formatPrice(meetingType.priceCents!, meetingType.priceCurrency ?? "eur"),
      billingFormUrl,
      note: body.note ?? null,
      logoUrl,
      reservationConfirmed: !strict,
    });
    sendEmailAfterResponse({
      to: sole.email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: host.name,
      replyTo: host.email,
      hostId: host.id,
      bookingId: pendingId,
    });
    return NextResponse.json({
      id: pendingId,
      kind: strict ? "awaiting-billing-details" : "confirmed-awaiting-billing",
    });
  }

  // ── Paid Stripe branch ──
  // Two sub-flows controlled by requirePayment:
  //   - default (false): create the booking, finalise immediately (Google event + standard
  //     confirmation email), THEN create the Stripe Checkout session and email the invitee a
  //     follow-up "please pay for this meeting" link. The reservation does not depend on
  //     payment landing. The webhook still flips paymentStatus to PAID when payment lands,
  //     and the finalize call on the webhook side is idempotent on googleEventId.
  //   - strict (true): the old behaviour — no Google event until the webhook fires PAID.
  //     paymentStatus stays PENDING, the email tells the invitee the slot is held only until
  //     payment completes.
  if (willStripe) {
    if (!isStripeConfigured()) {
      return new NextResponse("Payments are not configured on this server.", { status: 503 });
    }
    if (!meetingType.priceCurrency) {
      return new NextResponse("Meeting type has no priceCurrency set.", { status: 500 });
    }
    if (!host.stripeAccountId) {
      return new NextResponse("Connect Stripe under Settings → Payments first.", { status: 400 });
    }

    // Charge path is single-invitee (multi+charge rejected above).
    const sole = invitees[0];
    const requestId = requestIdForInvitee(sole.email);
    const strict = body.requirePayment === true;

    let pendingId: string;
    try {
      const created = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: sole.email,
          inviteeName: sole.name,
          inviteeAnswers: noteAnswer,
          startsAt,
          endsAt,
          requestId,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
        },
      });
      pendingId = created.id;
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await prisma.booking.findUnique({ where: { requestId } });
        if (existing) {
          return NextResponse.json({ id: existing.id, alreadyExists: true });
        }
      }
      throw err;
    }

    // Default flow: finalise now so the calendar invite goes out alongside the payment ask.
    // The webhook's later finalize call is a no-op (idempotent on googleEventId).
    if (!strict) {
      const result = await finalizeBooking({
        bookingId: pendingId,
        hostId: host.id,
        collectiveCoHostIds: [],
        inviteeTimezone: host.timezone,
      });
      if (!result.ok) {
        return new NextResponse(result.message, { status: result.status });
      }
    }

    // Build the public confirmation URL (success_url) — same shape as public POST.
    const slugForUrl =
      meetingType.scope === "PROJECT"
        ? (
            await prisma.project.findUnique({
              where: { id: meetingType.projectId! },
              select: { slug: true },
            })
          )?.slug ?? host.slug
        : host.slug;
    const baseUrl = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

    let checkoutUrl: string;
    let sessionId: string;
    try {
      const session = await stripeClient().checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: meetingType.priceCurrency,
                unit_amount: meetingType.priceCents!,
                product_data: {
                  name: meetingType.name,
                  description: meetingType.description ?? undefined,
                },
              },
              quantity: 1,
            },
          ],
          customer_email: invitees[0].email,
          client_reference_id: pendingId,
          metadata: {
            bookingId: pendingId,
            meetingTypeId: meetingType.id,
            // Best-effort: we don't know the invitee's actual tz, so use the host's. The
            // confirmation email renders times in this tz; invitee can swap later.
            inviteeTimezone: host.timezone,
            collectiveCoHostIds: "",
            hostInitiated: "1",
          },
          success_url: `${baseUrl}/${slugForUrl}/${meetingType.slug}/confirmed/${pendingId}?paid=1`,
          cancel_url: `${baseUrl}/${slugForUrl}/${meetingType.slug}?canceled=1`,
        },
        { stripeAccount: host.stripeAccountId },
      );
      if (!session.url) throw new Error("Stripe session has no url");
      checkoutUrl = session.url;
      sessionId = session.id;
    } catch (err) {
      console.error("[host-bookings] stripe checkout create failed", err);
      await prisma.booking.delete({ where: { id: pendingId } }).catch(() => undefined);
      return new NextResponse("Couldn't start the payment session — please try again.", { status: 502 });
    }

    await prisma.booking.update({
      where: { id: pendingId },
      data: { stripeSessionId: sessionId },
    });

    const logoUrl = await getEmailLogoUrl();
    const tmpl = hostInitiatedPaymentTemplate({
      hostName: host.name,
      meetingTypeName: meetingType.name,
      startsAtIso: startsAt.toISOString(),
      endsAtIso: endsAt.toISOString(),
      inviteeName: invitees[0].name,
      formattedPrice: formatPrice(meetingType.priceCents!, meetingType.priceCurrency),
      checkoutUrl,
      note: body.note ?? null,
      logoUrl,
      reservationConfirmed: !strict,
    });
    sendEmailAfterResponse({
      to: invitees[0].email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: host.name,
      replyTo: host.email,
      hostId: host.id,
      bookingId: pendingId,
    });

    return NextResponse.json({
      id: pendingId,
      kind: strict ? "awaiting-payment" : "confirmed-awaiting-payment",
    });
  }

  // ── Free / comp branch (single or multi-invitee) ──
  //
  // For multi-invitee group meetings: the first booking row runs finalize, which creates the
  // Google event with that invitee + host as attendees. Subsequent invitees on the same slot
  // re-use the public-flow's "join existing group" pattern — we patch the Google event to add
  // each new attendee, stamp the new booking row with the same googleEventId, and send a
  // confirmation. That guarantees one event in the host's calendar with everyone on it.
  const bookingIds: string[] = [];
  let primaryBookingId: string | null = null;
  let groupGoogleEventId: string | null = null;
  let groupMeetUrl: string | null = null;
  let groupConferencingProvider: typeof meetingType.conferencingProvider | null = null;
  let groupProviderMeetingId: string | null = null;

  for (let i = 0; i < invitees.length; i++) {
    const inv = invitees[i];
    const reqId = requestIdForInvitee(inv.email);
    let bid: string;
    try {
      const booking = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: inv.email,
          inviteeName: inv.name,
          inviteeAnswers: i === 0 ? noteAnswer : undefined,
          startsAt,
          endsAt,
          requestId: reqId,
          status: "CONFIRMED",
          // Pre-stamp group fields for invitees 2..N so finalize doesn't try to make another
          // Google event (it short-circuits on existing googleEventId).
          googleEventId: i === 0 ? null : groupGoogleEventId,
          meetUrl: i === 0 ? null : groupMeetUrl,
          conferencingProvider: i === 0 ? meetingType.conferencingProvider : (groupConferencingProvider ?? meetingType.conferencingProvider),
          providerMeetingId: i === 0 ? null : groupProviderMeetingId,
        },
      });
      bid = booking.id;
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await prisma.booking.findUnique({ where: { requestId: reqId } });
        if (existing) {
          // Duplicate retry — treat as already-handled and continue without re-finalizing.
          bookingIds.push(existing.id);
          if (i === 0) {
            primaryBookingId = existing.id;
            groupGoogleEventId = existing.googleEventId;
            groupMeetUrl = existing.meetUrl;
            groupConferencingProvider = existing.conferencingProvider;
            groupProviderMeetingId = existing.providerMeetingId;
          }
          continue;
        }
      }
      throw err;
    }
    bookingIds.push(bid);

    if (i === 0) {
      // Run finalize for the first invitee. It creates the Google event + sends the
      // confirmation to this invitee. The next iterations join via the patch path.
      const result = await finalizeBooking({
        bookingId: bid,
        hostId: host.id,
        collectiveCoHostIds: [],
        inviteeTimezone: host.timezone,
      });
      if (!result.ok) {
        return new NextResponse(result.message, { status: result.status });
      }
      primaryBookingId = bid;
      groupGoogleEventId = result.googleEventId;
      groupMeetUrl = result.meetUrl;
      // finalize doesn't return the provider fields; re-read from DB.
      const refreshed = await prisma.booking.findUnique({
        where: { id: bid },
        select: { conferencingProvider: true, providerMeetingId: true },
      });
      groupConferencingProvider = refreshed?.conferencingProvider ?? meetingType.conferencingProvider;
      groupProviderMeetingId = refreshed?.providerMeetingId ?? null;
    } else {
      // Group join: patch the Google event to add this invitee as an attendee, then send them
      // a confirmation email. Mirrors src/app/api/bookings/route.ts's group-join path.
      if (groupGoogleEventId && host.googleRefreshToken) {
        const writeTarget = host.calendars.find((c) => c.role === "WRITE_TARGET");
        if (writeTarget) {
          try {
            const cal = calendarFor(host.googleRefreshToken);
            const existingEv = await cal.events.get({
              calendarId: writeTarget.googleCalendarId,
              eventId: groupGoogleEventId,
            });
            const existingAttendees = existingEv.data.attendees ?? [];
            const alreadyOn = existingAttendees.some(
              (a) => (a.email ?? "").toLowerCase() === inv.email.toLowerCase(),
            );
            if (!alreadyOn) {
              await cal.events.patch({
                calendarId: writeTarget.googleCalendarId,
                eventId: groupGoogleEventId,
                sendUpdates: "none",
                requestBody: {
                  attendees: [
                    ...existingAttendees,
                    { email: inv.email, displayName: inv.name },
                  ],
                },
              });
            }
          } catch (err) {
            if (isGoogleAuthError(err)) {
              await prisma.host
                .update({ where: { id: host.id }, data: { googleRefreshToken: null } })
                .catch(() => undefined);
            }
            console.error("[host-bookings] group attendee patch failed", err);
            // Don't abort — the booking row is still created and the invitee will get an
            // email. The host can add them manually in Google Calendar if needed.
          }
        }
      }

      // Standard confirmation email to this invitee. Mirrors the booking-confirmation we send
      // for solo bookings — uses the existing template via the dynamic import-by-string pattern
      // is overkill; just inline the call to the shared template.
      const baseUrl = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
      const slugForUrl =
        meetingType.scope === "PROJECT"
          ? (
              await prisma.project.findUnique({
                where: { id: meetingType.projectId! },
                select: { slug: true },
              })
            )?.slug ?? host.slug
          : host.slug;
      const logoUrl = await getEmailLogoUrl();
      const tmpl = bookingConfirmationTemplate({
        hostName: host.name,
        meetingTypeName: meetingType.name,
        startsAtIso: startsAt.toISOString(),
        endsAtIso: endsAt.toISOString(),
        inviteeName: inv.name,
        inviteeEmail: inv.email,
        cancelUrl: `${baseUrl}/${slugForUrl}/${meetingType.slug}/confirmed/${bid}/cancel`,
        rescheduleUrl: `${baseUrl}/${slugForUrl}/${meetingType.slug}/confirmed/${bid}/reschedule`,
        meetUrl: groupMeetUrl,
        icalUrl: `${baseUrl}/${slugForUrl}/${meetingType.slug}/confirmed/${bid}/calendar.ics`,
        logoUrl,
      });
      sendEmailAfterResponse({
        to: inv.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        fromName: host.name,
        replyTo: host.email,
        bookingId: bid,
      });
    }
  }

  // Silence unused-import lint — kept around for future template swaps.
  void hostInitiatedFreeTemplate;
  void appUrl;

  return NextResponse.json({
    id: primaryBookingId ?? bookingIds[0],
    kind: "confirmed",
    bookingIds,
  });
}
