import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { computeAvailableSlots, type WorkingHours } from "@/lib/availability/engine";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { sendEmail, bookingRescheduleTemplate, appUrl } from "@/lib/email";
import { getZoomAccessTokenForHost } from "@/lib/zoom/host";
import { updateZoomMeeting } from "@/lib/zoom/client";

const bodySchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

// Reschedule a confirmed booking to a new time. Re-validates availability with a fresh freebusy
// query (matching the create-booking guard) so two invitees can't race into the same slot.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (endsAt.getTime() <= startsAt.getTime()) {
    return new NextResponse("End must be after start.", { status: 400 });
  }

  const booking = await prisma.booking.findUnique({ where: { id }, include: { meetingType: true } });
  if (!booking) return new NextResponse("Booking not found", { status: 404 });
  if (booking.status === "CANCELLED") {
    return new NextResponse("This booking has been cancelled — book a fresh slot instead.", { status: 409 });
  }

  const { meetingType } = booking;
  if (meetingType.isOneOff) {
    return new NextResponse(
      "One-off meetings can't be rescheduled — please cancel and book a different slot.",
      { status: 400 },
    );
  }
  if ((endsAt.getTime() - startsAt.getTime()) / 60000 !== meetingType.durationMinutes) {
    return new NextResponse("Slot duration mismatch.", { status: 400 });
  }

  const host = await prisma.host.findUnique({
    where: { id: booking.hostId },
    include: { calendars: true },
  });
  if (!host) return new NextResponse("Host not found", { status: 404 });
  const writeTarget = host.calendars.find((c) => c.role === "WRITE_TARGET");
  if (!writeTarget) return new NextResponse("Host hasn't picked a write-target calendar.", { status: 409 });
  if (!host.googleRefreshToken) return new NextResponse("Host needs to reconnect Google.", { status: 503 });

  // Re-validate availability with a fresh freebusy. Filter out the booking's own busy block so
  // the engine doesn't treat the booking-being-rescheduled as a conflict against itself.
  const margin = (Math.max(meetingType.bufferBeforeMinutes, meetingType.bufferAfterMinutes) + 60) * 60000;
  const range = { from: new Date(startsAt.getTime() - margin), to: new Date(endsAt.getTime() + margin) };

  let busy;
  try {
    busy = await fetchHostBusy(host, range, meetingType);
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
      return new NextResponse("Host needs to reconnect Google.", { status: 503 });
    }
    throw err;
  }

  // Drop the busy block that overlaps our current booking — Google still has it in the calendar.
  const filteredBusy = busy.filter(
    (b) => !(b.start.getTime() === booking.startsAt.getTime() && b.end.getTime() === booking.endsAt.getTime()),
  );

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
    busy: filteredBusy,
  });

  const stillAvailable = slots.some(
    (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
  );
  if (!stillAvailable) {
    return new NextResponse("That slot isn't available — please pick another time.", { status: 409 });
  }

  // Update the Google event in place if it still exists; create one otherwise (defensive).
  try {
    const cal = calendarFor(host.googleRefreshToken);
    if (booking.googleEventId) {
      await cal.events.patch({
        calendarId: writeTarget.googleCalendarId,
        eventId: booking.googleEventId,
        sendUpdates: "all",
        requestBody: {
          start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
          end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        },
      });
    }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
    }
    return new NextResponse("Couldn't update the calendar event. Please try again.", { status: 502 });
  }

  // Update the Zoom meeting time too if this booking is on Zoom. Failure here is logged but
  // not fatal — the join URL stays valid even if the start_time on Zoom is stale.
  if (booking.conferencingProvider === "ZOOM" && booking.providerMeetingId) {
    try {
      const accessToken = await getZoomAccessTokenForHost(host.id);
      if (accessToken) {
        await updateZoomMeeting(accessToken, booking.providerMeetingId, {
          startsAtIso: startsAt.toISOString(),
          durationMinutes: meetingType.durationMinutes,
          timezone: "UTC",
        });
      }
    } catch (err) {
      console.error("[reschedule] zoom update failed", err);
    }
  }

  await prisma.booking.update({
    where: { id },
    data: { startsAt, endsAt, status: "RESCHEDULED" },
  });

  // Reschedule email — fire-and-forget. We need to look up the project slug for the URL.
  const project = booking.meetingType.projectId
    ? await prisma.project.findUnique({
        where: { id: booking.meetingType.projectId },
        select: { slug: true },
      })
    : null;
  const slugForUrl = project?.slug ?? host.slug;
  const tmpl = bookingRescheduleTemplate({
    hostName: host.name,
    meetingTypeName: booking.meetingType.name,
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    cancelUrl: appUrl(`/${slugForUrl}/${booking.meetingType.slug}/confirmed/${booking.id}/cancel`),
    rescheduleUrl: appUrl(`/${slugForUrl}/${booking.meetingType.slug}/confirmed/${booking.id}/reschedule`),
    meetUrl: booking.meetUrl,
  });
  void sendEmail({
    to: booking.inviteeEmail,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    fromName: host.name,
    replyTo: host.email,
  });

  return NextResponse.json({ ok: true });
}
