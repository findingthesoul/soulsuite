import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { sendEmailAfterResponse, bookingCancellationTemplate, appUrl } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { getZoomAccessTokenForHost } from "@/lib/zoom/host";
import { deleteZoomMeeting } from "@/lib/zoom/client";
import { bustFreebusyCacheForHost } from "@/lib/availability/freebusy";

// Public cancel — anyone with the booking ID can cancel. The booking ID is a CUID (~22
// random chars), unguessable in practice, which mirrors the same access model as the
// confirmation page. Email-based magic links land later (build-order step 12).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { host: true, meetingType: true, project: true },
  });
  if (!booking) return new NextResponse("Booking not found", { status: 404 });
  if (booking.status === "CANCELLED") return NextResponse.json({ ok: true, alreadyCancelled: true });

  // Best-effort delete the Google event. If Google is broken we still mark the booking cancelled
  // — the host can clean up their calendar manually rather than leaving a "ghost" booking that
  // the invitee thinks is gone.
  if (booking.googleEventId && booking.host.googleRefreshToken) {
    try {
      const cal = calendarFor(booking.host.googleRefreshToken);
      // Find the write-target so we know which calendar holds the event.
      const writeTarget = await prisma.calendar.findFirst({
        where: { hostId: booking.hostId, role: "WRITE_TARGET" },
      });
      if (writeTarget) {
        await cal.events.delete({
          calendarId: writeTarget.googleCalendarId,
          eventId: booking.googleEventId,
          sendUpdates: "none",
        });
      }
    } catch (err) {
      if (isGoogleAuthError(err)) {
        await prisma.host.update({
          where: { id: booking.hostId },
          data: { googleRefreshToken: null },
        });
      }
      // 410 (event already deleted) and other errors are swallowed — we still mark cancelled.
    }
  }

  // Best-effort tear-down of the Zoom meeting too. Same philosophy as Google: we keep going on
  // failure so the booking gets marked cancelled either way.
  if (booking.conferencingProvider === "ZOOM" && booking.providerMeetingId) {
    try {
      const accessToken = await getZoomAccessTokenForHost(booking.hostId);
      if (accessToken) await deleteZoomMeeting(accessToken, booking.providerMeetingId);
    } catch (err) {
      console.error("[cancel] zoom delete failed", err);
    }
  }

  await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED", googleEventId: null },
  });

  // One-off: free up the slot so it can be claimed again.
  if (booking.meetingType.isOneOff) {
    await prisma.oneOffSlot
      .updateMany({
        where: { meetingTypeId: booking.meetingTypeId, bookedBookingId: booking.id },
        data: { bookedBookingId: null },
      })
      .catch(() => undefined);
  }

  // Cancellation email — fire-and-forget.
  const slugForUrl = booking.project?.slug ?? booking.host.slug;
  const tmpl = bookingCancellationTemplate({
    hostName: booking.host.name,
    meetingTypeName: booking.meetingType.name,
    startsAtIso: booking.startsAt.toISOString(),
    endsAtIso: booking.endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    cancelUrl: appUrl(`/${slugForUrl}/${booking.meetingType.slug}/confirmed/${booking.id}`),
    rescheduleUrl: appUrl(`/${slugForUrl}/${booking.meetingType.slug}/confirmed/${booking.id}/reschedule`),
    meetUrl: booking.meetUrl,
    logoUrl: await getEmailLogoUrl(),
  });
  sendEmailAfterResponse({
    to: booking.inviteeEmail,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    fromName: booking.host.name,
    replyTo: booking.host.email,
  });

  bustFreebusyCacheForHost(booking.hostId);
  return NextResponse.json({ ok: true });
}
