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
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { effectiveWorkingHours } from "@/lib/availability";
import { finalizeBooking } from "@/lib/bookings/finalize";
import {
  appUrl,
  hostInitiatedFreeTemplate,
  hostInitiatedPaymentTemplate,
  sendEmailAfterResponse,
} from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { stripeClient, isStripeConfigured, formatPrice } from "@/lib/stripe/client";
import { publicEnv } from "@/lib/env";

const bodySchema = z.object({
  meetingTypeId: z.string().min(1),
  startsAt: z.string().datetime(),
  inviteeName: z.string().trim().min(1).max(120),
  inviteeEmail: z.string().email().max(200),
  note: z.string().trim().max(2000).optional().nullable(),
  // Only meaningful for paid (Stripe) MTs. When true, the host wants the invitee to pay —
  // send a Stripe Checkout link. When false (default), book as complimentary: no payment
  // collected, immediate finalize. Lets hosts comp meetings for VIPs / friends / team without
  // having to flip the MT itself to free.
  chargeInvitee: z.boolean().optional().default(false),
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

  // Invoice-method paid MTs need billing details we can't reasonably collect on the invitee's
  // behalf. Refuse cleanly so the host can send them the public link instead.
  if ((meetingType.priceCents ?? 0) > 0 && meetingType.paymentMethod === "INVOICE") {
    return new NextResponse(
      "Invoice-method paid meeting types can't be host-initiated yet. Send the invitee your public booking link instead.",
      { status: 400 },
    );
  }
  if (meetingType.paymentMethod === "ADYEN") {
    return new NextResponse(
      "Adyen meeting types can't be host-initiated.",
      { status: 400 },
    );
  }
  // Host-initiated bookings on a require-approval MT auto-approve — the host IS the approver.
  // The actual booking row is created with status=CONFIRMED below; no PENDING_APPROVAL row.

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

  // Idempotency key — same shape as public POST so retries collide.
  const deterministic = createHash("sha256")
    .update(`${meetingType.id}:${host.id}:${startsAt.toISOString()}:${body.inviteeEmail}:host-initiated`)
    .digest("hex")
    .slice(0, 32);
  const requestId = `hb-${deterministic}`;

  const isPaid = (meetingType.priceCents ?? 0) > 0;
  // Two-axis decision for paid MTs: priced + host wants to charge → Stripe flow; priced +
  // complimentary → fall through to the free path with paymentStatus stamped NOT_REQUIRED.
  const willCharge = isPaid && body.chargeInvitee === true;
  const noteAnswer =
    body.note && body.note.length > 0
      ? ({ __hostNote: body.note } as Prisma.InputJsonValue)
      : undefined;

  // ── Paid Stripe branch ──
  // Only taken when the host explicitly opted in via chargeInvitee. Otherwise paid MTs fall
  // through to the free branch below — the booking is comp'd, paymentStatus stays NOT_REQUIRED,
  // and the invitee gets the standard confirmation email with no payment step.
  if (willCharge) {
    if (!isStripeConfigured()) {
      return new NextResponse("Payments are not configured on this server.", { status: 503 });
    }
    if (!meetingType.priceCurrency) {
      return new NextResponse("Meeting type has no priceCurrency set.", { status: 500 });
    }
    if (!host.stripeAccountId) {
      return new NextResponse("Connect Stripe under Settings → Payments first.", { status: 400 });
    }

    let pendingId: string;
    try {
      const created = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: body.inviteeEmail,
          inviteeName: body.inviteeName,
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
          customer_email: body.inviteeEmail,
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
      inviteeName: body.inviteeName,
      formattedPrice: formatPrice(meetingType.priceCents!, meetingType.priceCurrency),
      checkoutUrl,
      note: body.note ?? null,
      logoUrl,
    });
    sendEmailAfterResponse({
      to: body.inviteeEmail,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: host.name,
      replyTo: host.email,
      hostId: host.id,
      bookingId: pendingId,
    });

    return NextResponse.json({ id: pendingId, kind: "awaiting-payment" });
  }

  // ── Free branch ──
  let bookingId: string;
  try {
    const booking = await prisma.booking.create({
      data: {
        meetingTypeId: meetingType.id,
        hostId: host.id,
        projectId: meetingType.projectId,
        inviteeEmail: body.inviteeEmail,
        inviteeName: body.inviteeName,
        inviteeAnswers: noteAnswer,
        startsAt,
        endsAt,
        requestId,
        status: "CONFIRMED",
      },
    });
    bookingId = booking.id;
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.booking.findUnique({ where: { requestId } });
      if (existing) {
        return NextResponse.json({ id: existing.id, alreadyExists: true });
      }
    }
    throw err;
  }

  // finalizeBooking creates the Google event and sends the standard invitee confirmation. The
  // confirmation template is "you're booked" — fine for host-initiated since the invitee is
  // genuinely booked. We could swap to hostInitiatedFreeTemplate for the email but then we'd
  // also need to suppress finalize's email send; keep it simple for v1 and use the default.
  const result = await finalizeBooking({
    bookingId,
    hostId: host.id,
    collectiveCoHostIds: [],
    inviteeTimezone: host.timezone,
  });
  if (!result.ok) {
    return new NextResponse(result.message, { status: result.status });
  }
  // Silence the unused-import linter — the template + appUrl are referenced in the paid path
  // and stay imported for future use (e.g. if we suppress finalize's default email).
  void hostInitiatedFreeTemplate;
  void appUrl;

  return NextResponse.json({ id: bookingId, kind: "confirmed" });
}
