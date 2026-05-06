// Authenticated admin decline endpoint — counterpart to /approve.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";
import { declinePendingBooking } from "@/lib/bookings/approve";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await authorizeAdminBookingAction(caller, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const result = await declinePendingBooking({
    bookingId: id,
    decidedByHostId: caller.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
