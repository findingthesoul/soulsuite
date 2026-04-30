import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { computeAvailableSlots, type WorkingHours } from "@/lib/availability/engine";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { type IntakeField, validateAnswers, pruneHiddenAnswers } from "@/lib/intake";
import { pickRoundRobinHost } from "@/lib/round-robin";
import { sendEmail, bookingConfirmationTemplate, appUrl } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { getZoomAccessTokenForHost } from "@/lib/zoom/host";
import { createZoomMeeting } from "@/lib/zoom/client";

const bodySchema = z.object({
  meetingTypeId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  inviteeName: z.string().trim().min(1).max(120),
  inviteeEmail: z.string().email().max(200),
  inviteeTimezone: z.string().min(1).max(80),
  // Free-form answers; validated against the meeting type's intake form fields below.
  intakeAnswers: z.record(z.string(), z.unknown()).optional(),
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
  if ((endsAt.getTime() - startsAt.getTime()) / 60000 !== meetingType.durationMinutes) {
    return new NextResponse("Slot duration mismatch.", { status: 400 });
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

  const freeHosts: typeof candidateHosts = [];
  for (const cand of candidateHosts) {
    if (!cand.googleRefreshToken) continue;
    if (!cand.calendars.some((c) => c.role === "WRITE_TARGET")) continue;
    let busy;
    try {
      busy = await fetchHostBusy(cand, range, meetingType);
    } catch (err) {
      if (isGoogleAuthError(err)) {
        await prisma.host.update({ where: { id: cand.id }, data: { googleRefreshToken: null } });
        continue; // skip — try the next candidate
      }
      throw err;
    }
    const slots = computeAvailableSlots({
      host: { timezone: cand.timezone, workingHours: (cand.workingHours as WorkingHours | null) ?? {} },
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
    const isFree = slots.some(
      (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
    );
    if (isFree) freeHosts.push(cand);
  }

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
    );
    host = freeHosts.find((h) => h.id === winnerId) ?? freeHosts[0];
  } else if (meetingType.routingMode === "COLLECTIVE") {
    const firstId = candidateHostIds[0];
    host = freeHosts.find((h) => h.id === firstId) ?? freeHosts[0];
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

  // For ZOOM: create the meeting first, then attach the join link to the Google event
  // description + location. We do Zoom first so a Zoom failure doesn't leave a dangling
  // calendar event behind.
  let zoomMeeting: { meetingId: string; joinUrl: string; passcode: string | null } | null = null;
  if (meetingType.conferencingProvider === "ZOOM") {
    try {
      const accessToken = await getZoomAccessTokenForHost(host.id);
      if (!accessToken) {
        await prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
        return new NextResponse(
          "The host hasn't connected Zoom — please pick another time or contact them.",
          { status: 502 },
        );
      }
      zoomMeeting = await createZoomMeeting(accessToken, {
        topic: `${meetingType.name} — ${body.inviteeName}`,
        startsAtIso: startsAt.toISOString(),
        durationMinutes: meetingType.durationMinutes,
        timezone: "UTC",
        agenda: meetingType.description ?? undefined,
      });
    } catch (err) {
      console.error("[booking] zoom create failed", err);
      await prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
      return new NextResponse("Couldn't create the Zoom meeting — please try again.", { status: 502 });
    }
  }

  let bookingMeetUrl: string | null = zoomMeeting?.joinUrl ?? null;
  try {
    const cal = calendarFor(host.googleRefreshToken!);
    const useGoogleMeet = meetingType.conferencingProvider === "GOOGLE_MEET";
    const description =
      `Booked via Soul Suite.\n` +
      `Invitee: ${body.inviteeName} <${body.inviteeEmail}>\n` +
      (meetingType.description ? `\n${meetingType.description}\n` : "") +
      (zoomMeeting
        ? `\nJoin Zoom: ${zoomMeeting.joinUrl}` +
          (zoomMeeting.passcode ? `\nPasscode: ${zoomMeeting.passcode}` : "") +
          "\n"
        : "");
    const ev = await cal.events.insert({
      calendarId: writeTarget.googleCalendarId,
      conferenceDataVersion: useGoogleMeet ? 1 : 0,
      sendUpdates: "all",
      requestBody: {
        summary: `${meetingType.name} — ${body.inviteeName}`,
        description,
        location: bookingMeetUrl ?? undefined,
        start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        attendees: [
          { email: body.inviteeEmail, displayName: body.inviteeName },
          { email: host.email, displayName: host.name, organizer: true },
          ...collectiveCoHosts.map((h) => ({ email: h.email, displayName: h.name })),
        ],
        conferenceData: useGoogleMeet
          ? { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
          : undefined,
      },
    });
    if (!bookingMeetUrl && useGoogleMeet) bookingMeetUrl = ev.data.hangoutLink ?? null;
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        googleEventId: ev.data.id ?? null,
        conferencingProvider: meetingType.conferencingProvider,
        meetUrl: bookingMeetUrl,
        providerMeetingId: zoomMeeting?.meetingId ?? null,
      },
    });
    // Round-robin fairness: stamp the picked host so the next ROUND_ROBIN booking on this
    // project considers them most-recently-assigned (i.e. ranks them last).
    if (meetingType.scope === "PROJECT" && meetingType.routingMode === "ROUND_ROBIN") {
      await prisma.projectMember.update({
        where: { projectId_hostId: { projectId: meetingType.projectId!, hostId: host.id } },
        data: { lastAssignedAt: new Date() },
      });
    }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
    }
    // Roll back the booking row so the user can retry — otherwise they'd see "already booked"
    // on the next attempt thanks to the deterministic requestId.
    await prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
    return new NextResponse(
      "We couldn't create the calendar event. Please try again or pick a different time.",
      { status: 502 },
    );
  }

  // Confirmation email — fire-and-forget. Failures are logged inside sendEmail; we don't
  // block the booking on email delivery.
  const publicSlug = meetingType.scope === "PROJECT" ? undefined : host.slug;
  // For PROJECT bookings the URL uses the project slug; for PERSONAL it uses the host's.
  const slugForUrl = publicSlug ?? (await prisma.project.findUnique({
    where: { id: meetingType.projectId! },
    select: { slug: true },
  }))?.slug ?? host.slug;
  const logoUrl = await getEmailLogoUrl();
  const tmpl = bookingConfirmationTemplate({
    hostName: host.name,
    meetingTypeName: meetingType.name,
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    inviteeName: body.inviteeName,
    inviteeEmail: body.inviteeEmail,
    cancelUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${bookingId}/cancel`),
    rescheduleUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${bookingId}/reschedule`),
    meetUrl: bookingMeetUrl,
    icalUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${bookingId}/calendar.ics`),
    logoUrl,
  });
  void sendEmail({
    to: body.inviteeEmail,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    fromName: host.name,
    replyTo: host.email,
  });

  return NextResponse.json({ id: bookingId });
}
