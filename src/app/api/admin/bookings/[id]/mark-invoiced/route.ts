// POST /api/admin/bookings/[id]/mark-invoiced
// Tracking-only flag for invoice-payment bookings: flips paymentStatus from INVOICE_PENDING
// → INVOICE_SENT. No money moves; the host actually generates + sends the invoice in their own
// invoicing tool. Mirrors the auth surface of refund/retry-finalize.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  if (booking.paymentMethod !== "INVOICE") {
    return NextResponse.json(
      { error: "Only invoice bookings can be marked as invoiced" },
      { status: 409 },
    );
  }
  if (booking.paymentStatus !== "INVOICE_PENDING") {
    return NextResponse.json(
      { error: "Booking is not awaiting an invoice" },
      { status: 409 },
    );
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { paymentStatus: "INVOICE_SENT" },
  });

  return NextResponse.json({ ok: true });
}
