// POST /api/admin/bookings/[id]/retry-finalize
// Re-runs finalizeBooking() for a paid booking that was left in CANCELLED state because the
// original finalize call failed (Zoom create / Google insert / etc.). See
// src/lib/bookings/finalize.ts for the failure handling — for PAID bookings the row is kept
// so admins can recover via this endpoint.
//
// Auth: workspace OWNER/ADMIN that can manage the booking's host, or the host themselves.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { finalizeBooking } from "@/lib/bookings/finalize";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const caller = await getCurrentHost();
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const access = await authorizeAdminBookingAction(caller, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  const { booking } = access.data;

  if (booking.paymentStatus !== "PAID") {
    return NextResponse.json(
      { error: "Booking is not in a PAID state; nothing to retry" },
      { status: 409 },
    );
  }
  if (booking.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Booking is not in a failed-finalize state" },
      { status: 409 },
    );
  }
  if (booking.googleEventId) {
    return NextResponse.json(
      { error: "Booking already has a calendar event; refusing to retry" },
      { status: 409 },
    );
  }

  // For COLLECTIVE: hostId on the booking is the conferencing host (set at booking time);
  // co-hosts come from the meeting type's assignedHostIds minus the conferencing host. For
  // SINGLE / ROUND_ROBIN: no co-hosts.
  const isCollective = booking.meetingType.routingMode === "COLLECTIVE";
  const coHostIds = isCollective
    ? booking.meetingType.assignedHostIds.filter((hid) => hid !== booking.hostId)
    : [];

  // Flip status back to CONFIRMED before retrying — finalize doesn't touch status on the
  // happy path, and we want the row to look healthy if finalize succeeds. On failure,
  // finalize() itself will flip it back to CANCELLED (paid-row path).
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "CONFIRMED" },
  });

  const result = await finalizeBooking({
    bookingId: booking.id,
    hostId: booking.hostId,
    collectiveCoHostIds: coHostIds,
    inviteeTimezone: "UTC",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status === 502 ? 502 : 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
