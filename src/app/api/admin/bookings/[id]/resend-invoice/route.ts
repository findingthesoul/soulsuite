// POST /api/admin/bookings/[id]/resend-invoice
// Re-issues a Soul-Suite invoice for an INVOICE booking: deactivates the previous Stripe payment
// link (if any), generates a fresh one, and re-sends the invoice email. Invoice number is
// preserved. No-op + 409 if the host's invoiceSource is EXTERNAL or the booking is already PAID.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";
import { sendSoulSuiteInvoice } from "@/lib/bookings/send-invoice";

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

  const result = await sendSoulSuiteInvoice({ bookingId: id, regenerate: true });
  if (!result.ok) {
    const status = result.status === "skipped" ? 409 : 500;
    return NextResponse.json({ error: result.reason ?? "send failed" }, { status });
  }
  return NextResponse.json({
    ok: true,
    invoiceNumber: result.invoiceNumber,
    paymentLinkUrl: result.paymentLinkUrl,
  });
}
