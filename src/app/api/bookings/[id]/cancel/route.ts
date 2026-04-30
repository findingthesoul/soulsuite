import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";

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
    include: { host: true },
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
          sendUpdates: "all",
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

  await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED", googleEventId: null },
  });

  return NextResponse.json({ ok: true });
}
