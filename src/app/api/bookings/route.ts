import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { computeAvailableSlots, type WorkingHours } from "@/lib/availability/engine";
import { fetchHostBusy } from "@/lib/availability/freebusy";

const bodySchema = z.object({
  meetingTypeId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  inviteeName: z.string().trim().min(1).max(120),
  inviteeEmail: z.string().email().max(200),
  inviteeTimezone: z.string().min(1).max(80),
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

  const meetingType = await prisma.meetingType.findUnique({ where: { id: body.meetingTypeId } });
  if (!meetingType || !meetingType.isActive) return new NextResponse("Meeting type not found", { status: 404 });
  if (meetingType.scope !== "PERSONAL" || !meetingType.hostId) {
    return new NextResponse("Project meeting types are not yet supported.", { status: 400 });
  }
  if ((endsAt.getTime() - startsAt.getTime()) / 60000 !== meetingType.durationMinutes) {
    return new NextResponse("Slot duration mismatch.", { status: 400 });
  }

  const host = await prisma.host.findUnique({
    where: { id: meetingType.hostId },
    include: { calendars: true },
  });
  if (!host) return new NextResponse("Host not found", { status: 404 });
  const writeTarget = host.calendars.find((c) => c.role === "WRITE_TARGET");
  if (!writeTarget) {
    return new NextResponse("Host hasn't picked a write-target calendar.", { status: 409 });
  }
  if (!host.googleRefreshToken) {
    return new NextResponse("Host needs to reconnect Google.", { status: 503 });
  }

  // Re-validate availability with a fresh freebusy call. We expand the query window slightly
  // around the requested slot to give the engine context for buffer logic (brief §6).
  const margin = (Math.max(meetingType.bufferBeforeMinutes, meetingType.bufferAfterMinutes) + 60) * 60000;
  const range = { from: new Date(startsAt.getTime() - margin), to: new Date(endsAt.getTime() + margin) };

  let busy;
  try {
    busy = await fetchHostBusy(host, range);
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
      return new NextResponse("Host needs to reconnect Google.", { status: 503 });
    }
    throw err;
  }

  const slots = computeAvailableSlots({
    host: { timezone: host.timezone, workingHours: (host.workingHours as WorkingHours | null) ?? {} },
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

  const stillAvailable = slots.some(
    (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
  );
  if (!stillAvailable) {
    return new NextResponse("That slot is no longer available — please pick another time.", { status: 409 });
  }

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

  try {
    const cal = calendarFor(host.googleRefreshToken);
    const ev = await cal.events.insert({
      calendarId: writeTarget.googleCalendarId,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: `${meetingType.name} — ${body.inviteeName}`,
        description:
          `Booked via Soul Suite.\n` +
          `Invitee: ${body.inviteeName} <${body.inviteeEmail}>\n` +
          (meetingType.description ? `\n${meetingType.description}\n` : ""),
        start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        attendees: [
          { email: body.inviteeEmail, displayName: body.inviteeName },
          { email: host.email, displayName: host.name, organizer: true },
        ],
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    await prisma.booking.update({
      where: { id: bookingId },
      data: { googleEventId: ev.data.id ?? null },
    });
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

  return NextResponse.json({ id: bookingId });
}
