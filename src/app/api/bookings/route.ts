import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { effectiveWorkingHours } from "@/lib/availability";
import { fetchHostBusy, bustFreebusyCacheForHost } from "@/lib/availability/freebusy";
import { type IntakeField, validateAnswers, pruneHiddenAnswers } from "@/lib/intake";
import { pickRoundRobinHost } from "@/lib/round-robin";
import { sendEmail, bookingConfirmationTemplate, appUrl } from "@/lib/email";
import { upsertContactFromBooking, workspaceIdForMeetingType } from "@/lib/contacts";
import { finalizeBooking } from "@/lib/bookings/finalize";
import { stripeClient, isStripeConfigured } from "@/lib/stripe/client";
import { invoiceDetailsSchema } from "@/lib/bookings/invoice-details";
import { sendSoulSuiteInvoice } from "@/lib/bookings/send-invoice";
import { publicEnv } from "@/lib/env";

const bodySchema = z.object({
  meetingTypeId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  inviteeName: z.string().trim().min(1).max(120),
  inviteeEmail: z.string().email().max(200),
  inviteeTimezone: z.string().min(1).max(80),
  // Free-form answers; validated against the meeting type's intake form fields below.
  intakeAnswers: z.record(z.string(), z.unknown()).optional(),
  // Optional billing info — required (and validated against the strict schema) only when the
  // resolved meeting type's paymentMethod === INVOICE. The client always sends the field shape
  // it captured; we re-validate server-side because the public booking API has no auth.
  invoiceDetails: z.unknown().optional(),
});

/**
 * Public booking creation. Brief §6 + §Race conditions:
 *   1. Resolve the meeting type + host.
 *   2. Re-validate availability with a fresh freebusy call.
 *   3. Insert the Booking row inside a transaction. The unique `requestId` constraint guards
 *      retries (idempotency). After insert, create the Google Calendar event on the host's
 *      write-target calendar with `conferenceDataVersion=1` for a Meet link.
 *   4. Return the booking id; the client navigates to /confirmed/[id].
 *
 * Errors:
 *   - 404 if the meeting type/host doesn't exist or the host has no write-target calendar
 *   - 409 if the slot is no longer available (race-loss)
 *   - 503 if the host's Google credentials are revoked
 */
export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const body = parsed.data;
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);

  if (endsAt.getTime() <= startsAt.getTime()) {
    return new NextResponse("End must be after start.", { status: 400 });
  }

  const meetingType = await prisma.meetingType.findUnique({
    where: { id: body.meetingTypeId },
    include: { intakeForm: true },
  });
  if (!meetingType || !meetingType.isActive) return new NextResponse("Meeting type not found", { status: 404 });

  // Group meetings: when maxInvitees > 1, multiple Booking rows share one Google event for the
  // same (meetingTypeId, startsAt). Check capacity up front; the host's own freebusy can ignore
  // the existing group event since adding more attendees doesn't conflict. One-off meetings
  // can't be group (maxInvitees stays 1) so the two branches are independent.
  const isGroup = meetingType.maxInvitees > 1;
  const existingGroupBookings = isGroup
    ? await prisma.booking.findMany({
        where: { meetingTypeId: meetingType.id, startsAt, status: "CONFIRMED" },
        orderBy: { createdAt: "asc" },
      })
    : [];
  if (isGroup && existingGroupBookings.length >= meetingType.maxInvitees) {
    return new NextResponse("That slot is full — please pick another time.", { status: 409 });
  }
  if (isGroup && existingGroupBookings.some((b) => b.inviteeEmail === body.inviteeEmail)) {
    // Idempotent: the same invitee re-submitting returns the existing booking.
    return NextResponse.json({ id: existingGroupBookings.find((b) => b.inviteeEmail === body.inviteeEmail)!.id });
  }
  // One-off slots can have arbitrary durations, so we skip the strict-match check; the slot
  // load below validates against the actual OneOffSlot.endsAt - startsAt.
  if (!meetingType.isOneOff && (endsAt.getTime() - startsAt.getTime()) / 60000 !== meetingType.durationMinutes) {
    return new NextResponse("Slot duration mismatch.", { status: 400 });
  }

  // One-off path: the requested startsAt must match an unbooked OneOffSlot. We claim the slot
  // (set bookedBookingId) below after creating the Booking row. Skip the availability engine.
  let oneOffSlot: { id: string; startsAt: Date; endsAt: Date } | null = null;
  if (meetingType.isOneOff) {
    const slot = await prisma.oneOffSlot.findUnique({
      where: { meetingTypeId_startsAt: { meetingTypeId: meetingType.id, startsAt } },
    });
    if (!slot) return new NextResponse("That slot doesn't exist on this meeting type.", { status: 404 });
    if (slot.bookedBookingId) {
      return new NextResponse("That slot is already taken — please pick another.", { status: 409 });
    }
    if (slot.endsAt.getTime() !== endsAt.getTime()) {
      return new NextResponse("Slot end time mismatch.", { status: 400 });
    }
    oneOffSlot = { id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt };
  }

  // Resolve the host. PERSONAL → meetingType.hostId. PROJECT/SINGLE → assignedHostIds[0].
  // PROJECT/ROUND_ROBIN → pick the least-recently-assigned host that's actually free at the
  // requested slot. We compute that below after running freebusy.
  let candidateHostIds: string[];
  if (meetingType.scope === "PERSONAL") {
    if (!meetingType.hostId) return new NextResponse("Meeting type has no host", { status: 404 });
    candidateHostIds = [meetingType.hostId];
  } else {
    candidateHostIds = meetingType.assignedHostIds;
    if (candidateHostIds.length === 0) {
      return new NextResponse("Meeting type has no host", { status: 404 });
    }
  }

  // Re-validate availability with a fresh freebusy call against EVERY candidate host (one for
  // SINGLE, many for ROUND_ROBIN). A host counts as "free" only if their fresh slots include
  // the requested time. We collect the free ones and pick the fairness winner below.
  const margin = (Math.max(meetingType.bufferBeforeMinutes, meetingType.bufferAfterMinutes) + 60) * 60000;
  const range = { from: new Date(startsAt.getTime() - margin), to: new Date(endsAt.getTime() + margin) };

  const candidateHosts = await prisma.host.findMany({
    where: { id: { in: candidateHostIds } },
    include: { calendars: true },
  });

  // For project-scoped MTs, surface each candidate host's per-project working-hours override so
  // the freebusy re-validation respects it (mirrors the engine's resolution order).
  const projectMemberOverrideByHostId = new Map<string, unknown>();
  if (meetingType.scope === "PROJECT" && meetingType.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: meetingType.projectId, hostId: { in: candidateHostIds } },
      select: { hostId: true, workingHoursOverride: true },
    });
    for (const m of members) {
      projectMemberOverrideByHostId.set(m.hostId, m.workingHoursOverride);
    }
  }

  // Run freebusy in parallel — for ROUND_ROBIN / COLLECTIVE this used to be sequential, one
  // Google round-trip per host before the page could move on. Each host's check is independent.
  type Cand = (typeof candidateHosts)[number];
  type Verdict = { host: Cand; free: boolean } | { host: Cand; authBroken: true };
  const verdicts = await Promise.all<Verdict | null>(
    candidateHosts.map(async (cand) => {
      if (!cand.googleRefreshToken) return null;
      if (!cand.calendars.some((c) => c.role === "WRITE_TARGET")) return null;
      // One-off slots bypass the availability engine — the host hand-picked these times so
      // working hours / buffers / freebusy don't apply.
      if (oneOffSlot) return { host: cand, free: true };
      try {
        const busy = await fetchHostBusy(cand, range, meetingType);
        const slots = computeAvailableSlots({
          host: {
            timezone: cand.timezone,
            workingHours: effectiveWorkingHours(
              meetingType,
              cand,
              projectMemberOverrideByHostId.get(cand.id),
            ),
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
        return { host: cand, free };
      } catch (err) {
        if (isGoogleAuthError(err)) return { host: cand, authBroken: true };
        throw err;
      }
    }),
  );

  // Drain auth-broken hosts to the DB once, post-hoc — keeps the parallel scan clean.
  const brokenHostIds = verdicts
    .filter((v): v is { host: Cand; authBroken: true } => Boolean(v && "authBroken" in v))
    .map((v) => v.host.id);
  if (brokenHostIds.length > 0) {
    await prisma.host.updateMany({
      where: { id: { in: brokenHostIds } },
      data: { googleRefreshToken: null },
    });
  }
  const freeHosts: typeof candidateHosts = verdicts
    .filter((v): v is { host: Cand; free: boolean } => Boolean(v && "free" in v && v.free))
    .map((v) => v.host);

  // COLLECTIVE requires every assigned host to be free. ROUND_ROBIN/SINGLE only need at least one.
  if (meetingType.routingMode === "COLLECTIVE") {
    if (freeHosts.length !== candidateHostIds.length) {
      return new NextResponse("That slot is no longer available — please pick another time.", { status: 409 });
    }
  } else if (freeHosts.length === 0) {
    return new NextResponse("That slot is no longer available — please pick another time.", { status: 409 });
  }

  // Pick the actual booking host. SINGLE → only candidate. ROUND_ROBIN → least-recently-assigned
  // among the free candidates (tie-broken by ProjectMember.addedAt for stable behaviour).
  // COLLECTIVE → deterministic first id in assignedHostIds (the "saving" host owns the calendar
  // event + Zoom meeting; everyone else is added as an attendee so the Meet link works for all).
  let host: (typeof freeHosts)[number];
  if (meetingType.scope === "PROJECT" && meetingType.routingMode === "ROUND_ROBIN" && freeHosts.length > 1) {
    const winnerId = await pickRoundRobinHost(
      meetingType.projectId!,
      freeHosts.map((h) => h.id),
      { meetingTypeId: meetingType.id, assignedHostIds: meetingType.assignedHostIds },
    );
    host = freeHosts.find((h) => h.id === winnerId) ?? freeHosts[0];
  } else if (meetingType.routingMode === "COLLECTIVE") {
    // Conferencing host (set on the MT) owns the calendar event + Zoom meeting; the rest are
    // co-hosts/attendees. Falls back to assignedHostIds[0] for legacy MTs predating the picker.
    const ownerId = meetingType.conferencingHostId ?? candidateHostIds[0];
    host = freeHosts.find((h) => h.id === ownerId) ?? freeHosts[0];
  } else {
    host = freeHosts[0];
  }

  // For COLLECTIVE: every assigned host (other than the saving host) is added as an attendee
  // on the Google event so the Meet link works for everyone.
  const collectiveCoHosts =
    meetingType.routingMode === "COLLECTIVE"
      ? freeHosts.filter((h) => h.id !== host.id)
      : [];

  const writeTarget = host.calendars.find((c) => c.role === "WRITE_TARGET")!;

  // Validate intake answers against the meeting type's form (if any). Hidden answers are pruned
  // so the stored row only reflects what the user actually saw.
  const intakeFields = (meetingType.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];
  const rawAnswers = body.intakeAnswers ?? {};
  const intakeError = validateAnswers(intakeFields, rawAnswers);
  if (intakeError) return new NextResponse(intakeError.message, { status: 400 });
  const cleanedAnswers = pruneHiddenAnswers(intakeFields, rawAnswers);

  // Idempotent request id: derived from (meetingType, host, startsAt, inviteeEmail) so retries
  // collide on the unique index instead of double-booking. UUID prefix lets us see distinct
  // attempts in logs even when the deterministic part matches.
  const deterministic = createHash("sha256")
    .update(`${meetingType.id}:${host.id}:${startsAt.toISOString()}:${body.inviteeEmail}`)
    .digest("hex")
    .slice(0, 32);
  const requestId = `bk-${deterministic}`;

  // ── Paid meeting types: branch on the MT's payment method ──
  const isPaid = (meetingType.priceCents ?? 0) > 0;

  // INVOICE: capture billing details and finalise immediately like a free MT. No Stripe call.
  // Booking.paymentStatus = INVOICE_PENDING signals the admin Payments page that the host still
  // needs to send + collect on the invoice manually.
  if (isPaid && meetingType.paymentMethod === "INVOICE") {
    const invoiceParsed = invoiceDetailsSchema.safeParse(body.invoiceDetails);
    if (!invoiceParsed.success) {
      return new NextResponse(
        invoiceParsed.error.issues[0]?.message ?? "Billing details are required.",
        { status: 400 },
      );
    }
    let invoiceBookingId: string;
    try {
      const created = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: body.inviteeEmail,
          inviteeName: body.inviteeName,
          inviteeAnswers:
            Object.keys(cleanedAnswers).length > 0
              ? (cleanedAnswers as Prisma.InputJsonValue)
              : undefined,
          startsAt,
          endsAt,
          requestId,
          status: "CONFIRMED",
          paymentMethod: "INVOICE",
          paymentStatus: "INVOICE_PENDING",
          invoiceDetails: invoiceParsed.data as Prisma.InputJsonValue,
        },
      });
      invoiceBookingId = created.id;
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        const existing = await prisma.booking.findUnique({ where: { requestId } });
        if (existing) return NextResponse.json({ id: existing.id });
      }
      throw err;
    }

    // One-off slot claim — same logic as the free path; only difference is no Stripe.
    if (oneOffSlot) {
      const claim = await prisma.oneOffSlot.updateMany({
        where: { id: oneOffSlot.id, bookedBookingId: null },
        data: { bookedBookingId: invoiceBookingId },
      });
      if (claim.count === 0) {
        await prisma.booking.delete({ where: { id: invoiceBookingId } }).catch(() => undefined);
        return new NextResponse(
          "That slot was just claimed by someone else — please pick another.",
          { status: 409 },
        );
      }
    }

    // Group-meeting "join existing" path is intentionally unreachable here: invoice MTs aren't
    // configured as group meetings in normal flows (the form doesn't surface both at once),
    // and existingGroupBookings would be filtered out above. If a host does configure both we
    // fall through to finalizeBooking below, which creates a fresh event.

    const result = await finalizeBooking({
      bookingId: invoiceBookingId,
      hostId: host.id,
      collectiveCoHostIds: collectiveCoHosts.map((h) => h.id),
      inviteeTimezone: body.inviteeTimezone,
    });
    if (!result.ok) {
      return new NextResponse(result.message, { status: result.status });
    }

    // Soul-Suite invoice delivery — only when the host opted in. Failures here are logged but
    // don't reverse the booking; admin can retry from the Payments page.
    if (host.invoiceSource === "SOUL_SUITE") {
      const inv = await sendSoulSuiteInvoice({ bookingId: invoiceBookingId });
      if (!inv.ok) {
        console.warn("[booking] Soul Suite invoice send failed", {
          bookingId: invoiceBookingId,
          status: inv.status,
          reason: inv.reason,
        });
      }
    }

    return NextResponse.json({ id: invoiceBookingId });
  }

  // ── Paid meeting types: Stripe Checkout branch ──
  // For paid MTs we create the Booking row in PENDING state and a Stripe Checkout Session
  // tied to the host's connected Stripe account. The webhook (/api/stripe/webhook) flips
  // PAID and runs finalizeBooking() to create the Google event + emails. Group meetings and
  // one-off slots use the same idempotent Booking row so duplicate clicks collide on requestId.
  if (isPaid) {
    if (!isStripeConfigured()) {
      return new NextResponse("Payments are not configured on this server.", { status: 503 });
    }
    if (!meetingType.priceCurrency) {
      return new NextResponse("Meeting type has no priceCurrency set.", { status: 500 });
    }
    if (!host.stripeAccountId) {
      return new NextResponse(
        "This meeting host hasn't connected Stripe yet. Please contact them.",
        { status: 502 },
      );
    }

    // Create the PENDING booking row first (idempotent via requestId).
    let pendingId: string;
    try {
      const created = await prisma.booking.create({
        data: {
          meetingTypeId: meetingType.id,
          hostId: host.id,
          projectId: meetingType.projectId,
          inviteeEmail: body.inviteeEmail,
          inviteeName: body.inviteeName,
          inviteeAnswers:
            Object.keys(cleanedAnswers).length > 0
              ? (cleanedAnswers as Prisma.InputJsonValue)
              : undefined,
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
          // If we already have a Checkout session for this booking, return that URL —
          // otherwise create a fresh session (e.g. previous Stripe call failed). The session
          // ID is overwritten on the booking row so the webhook always finds the latest.
          if (existing.paymentStatus === "PAID") {
            return NextResponse.json({ id: existing.id });
          }
          pendingId = existing.id;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

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
            inviteeTimezone: body.inviteeTimezone,
            collectiveCoHostIds: collectiveCoHosts.map((h) => h.id).join(","),
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
      console.error("[booking] stripe checkout create failed", err);
      // Roll back the PENDING booking — they can retry with a fresh requestId only if we delete it.
      await prisma.booking.delete({ where: { id: pendingId } }).catch(() => undefined);
      return new NextResponse("Couldn't start the payment session — please try again.", {
        status: 502,
      });
    }

    await prisma.booking.update({
      where: { id: pendingId },
      data: { stripeSessionId: sessionId },
    });

    return NextResponse.json({ id: pendingId, checkoutUrl });
  }

  // Create the Booking row first (with idempotency), then create the Google event. If Google
  // fails, we keep the row but leave googleEventId null — the host can retry from the dashboard
  // (added in step 12). For now: delete the row on Google failure so the user can re-attempt.
  let bookingId: string;
  try {
    const booking = await prisma.booking.create({
      data: {
        meetingTypeId: meetingType.id,
        hostId: host.id,
        projectId: meetingType.projectId,
        inviteeEmail: body.inviteeEmail,
        inviteeName: body.inviteeName,
        inviteeAnswers:
          Object.keys(cleanedAnswers).length > 0
            ? (cleanedAnswers as Prisma.InputJsonValue)
            : undefined,
        startsAt,
        endsAt,
        requestId,
        status: "CONFIRMED",
      },
    });
    bookingId = booking.id;
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      // Same email + same start = same booking. Idempotent: return existing.
      const existing = await prisma.booking.findUnique({ where: { requestId } });
      if (existing) return NextResponse.json({ id: existing.id });
    }
    throw err;
  }

  // One-off: claim the slot via a conditional updateMany — only succeeds when bookedBookingId
  // is still null. If 0 rows updated, another invitee won the race; roll back our booking row.
  if (oneOffSlot) {
    const claim = await prisma.oneOffSlot.updateMany({
      where: { id: oneOffSlot.id, bookedBookingId: null },
      data: { bookedBookingId: bookingId },
    });
    if (claim.count === 0) {
      await prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
      return new NextResponse("That slot was just claimed by someone else — please pick another.", {
        status: 409,
      });
    }
  }

  // Group-meeting "join existing slot" path: 2nd+ invitee on the same (meetingTypeId, startsAt).
  // Reuse the first booking's Google event + Zoom meeting, just patch the attendee list.
  if (isGroup && existingGroupBookings.length > 0) {
    const anchor = existingGroupBookings[0];
    if (anchor.googleEventId && host.googleRefreshToken) {
      try {
        const cal = calendarFor(host.googleRefreshToken);
        const existingEv = await cal.events.get({
          calendarId: writeTarget.googleCalendarId,
          eventId: anchor.googleEventId,
        });
        const existingAttendees = existingEv.data.attendees ?? [];
        const alreadyOn = existingAttendees.some(
          (a) => (a.email ?? "").toLowerCase() === body.inviteeEmail.toLowerCase(),
        );
        const nextAttendees = alreadyOn
          ? existingAttendees
          : [
              ...existingAttendees,
              { email: body.inviteeEmail, displayName: body.inviteeName },
            ];
        await cal.events.patch({
          calendarId: writeTarget.googleCalendarId,
          eventId: anchor.googleEventId,
          sendUpdates: "none",
          requestBody: { attendees: nextAttendees },
        });
      } catch (err) {
        if (isGoogleAuthError(err)) {
          await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
        }
        await prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
        return new NextResponse(
          "We couldn't add you to the existing meeting. Please try again.",
          { status: 502 },
        );
      }
    }
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        googleEventId: anchor.googleEventId,
        conferencingProvider: anchor.conferencingProvider,
        meetUrl: anchor.meetUrl,
        providerMeetingId: anchor.providerMeetingId,
      },
    });

    // Confirmation email — same template as below.
    const publicSlug = meetingType.scope === "PROJECT" ? undefined : host.slug;
    const slugForUrl =
      publicSlug ??
      (await prisma.project.findUnique({
        where: { id: meetingType.projectId! },
        select: { slug: true },
      }))?.slug ??
      host.slug;
    const tmpl = bookingConfirmationTemplate({
      hostName: host.name,
      meetingTypeName: meetingType.name,
      startsAtIso: startsAt.toISOString(),
      endsAtIso: endsAt.toISOString(),
      inviteeName: body.inviteeName,
      inviteeEmail: body.inviteeEmail,
      cancelUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${bookingId}/cancel`),
      rescheduleUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${bookingId}/reschedule`),
      meetUrl: anchor.meetUrl,
    });
    void sendEmail({
      to: body.inviteeEmail,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: host.name,
      replyTo: host.email,
    });
    // Auto-build the workspace contact directory. Failures must not fail the booking.
    try {
      const wsId = await workspaceIdForMeetingType(meetingType.id);
      if (wsId) {
        await upsertContactFromBooking({
          workspaceId: wsId,
          email: body.inviteeEmail,
          name: body.inviteeName,
          timeZone: body.inviteeTimezone,
        });
      }
    } catch (err) {
      console.error("[booking] contact upsert failed (group)", err);
    }
    bustFreebusyCacheForHost(host.id);
    return NextResponse.json({ id: bookingId });
  }

  // ── Free meeting types: finalise immediately ──
  // Paid MTs returned earlier with a Checkout URL; the webhook handles their finalisation. Free
  // MTs go through the same finalize() path the webhook uses, so behaviour stays identical.
  const result = await finalizeBooking({
    bookingId,
    hostId: host.id,
    collectiveCoHostIds: collectiveCoHosts.map((h) => h.id),
    inviteeTimezone: body.inviteeTimezone,
  });
  if (!result.ok) {
    return new NextResponse(result.message, { status: result.status });
  }
  return NextResponse.json({ id: bookingId });
}
