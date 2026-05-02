// POST /api/admin/bookings/[id]/mark-paid
// Tracking-only flag for invoice bookings after the invoice was paid externally. Flips
// paymentStatus → PAID. We allow it from either INVOICE_PENDING (host skipped the "invoiced"
// step) or INVOICE_SENT. Stripe bookings are not handled here — those reach PAID via the
// Stripe webhook automatically.

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
      { error: "Use the Stripe webhook for non-invoice bookings" },
      { status: 409 },
    );
  }
  if (
    booking.paymentStatus !== "INVOICE_PENDING" &&
    booking.paymentStatus !== "INVOICE_SENT"
  ) {
    return NextResponse.json(
      { error: "Booking is not in an invoice state" },
      { status: 409 },
    );
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { paymentStatus: "PAID" },
  });

  return NextResponse.json({ ok: true });
}
