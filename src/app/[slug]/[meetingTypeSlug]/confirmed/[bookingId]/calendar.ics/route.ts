import { NextResponse } from "next/server";
import { resolvePublicBooking } from "@/lib/booking-public";
import { buildBookingIcal } from "@/lib/ical";

// Public iCal feed for a single booking. Anyone with the booking ID can fetch — same access
// model as the confirmation page (the ID is an unguessable CUID). Linked from the
// confirmation/reschedule emails so invitees on Apple/Outlook/etc. can add the meeting in
// one click.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; meetingTypeSlug: string; bookingId: string }> },
) {
  const { slug, meetingTypeSlug, bookingId } = await params;
  const booking = await resolvePublicBooking(slug, meetingTypeSlug, bookingId);
  if (!booking) return new NextResponse("Not found", { status: 404 });

  const ics = buildBookingIcal({
    uid: `booking-${booking.id}@suite.soul.com`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    summary: `${booking.meetingType.name} with ${booking.host.name}`,
    description: [
      booking.meetingType.description ?? "",
      booking.meetUrl ? `\nJoin: ${booking.meetUrl}` : "",
    ]
      .filter(Boolean)
      .join("")
      .trim(),
    location: booking.meetUrl ?? undefined,
    organizerName: booking.host.name,
    organizerEmail: booking.host.email,
    attendeeName: booking.inviteeName,
    attendeeEmail: booking.inviteeEmail,
    status: booking.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="soul-suite-${booking.id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
