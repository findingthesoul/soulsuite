// POST /api/bookings/[id]/submit-invoice-details?token=...
//
// Public, token-gated endpoint. Used when a host-initiated INVOICE booking is sitting in
// PENDING with an invoiceDetailsToken — the invitee submits their billing block here, which:
//   1. Validates the body against invoiceDetailsSchema.
//   2. Writes invoiceDetails on the booking, flips paymentStatus to INVOICE_PENDING.
//   3. Clears invoiceDetailsToken so the link is one-shot.
//   4. Runs finalizeBooking() → creates the Google event + sends the standard confirmation.
//
// Idempotency: once invoiceDetailsToken is cleared the endpoint returns 410 — re-submitting
// the same link no-ops. The Soul-Suite-issued-invoice path (host.invoiceSource = SOUL_SUITE)
// is kicked off the same way as a normal public-INVOICE booking — sendSoulSuiteInvoice runs
// after finalize succeeds.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invoiceDetailsSchema } from "@/lib/bookings/invoice-details";
import { finalizeBooking } from "@/lib/bookings/finalize";
import { sendSoulSuiteInvoice } from "@/lib/bookings/send-invoice";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Missing token.", { status: 400 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceDetailsToken: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      hostId: true,
      googleEventId: true,
      host: { select: { invoiceSource: true } },
    },
  });
  if (!booking) return new NextResponse("Booking not found.", { status: 404 });
  // Token must match exactly. Once the link is consumed it's cleared, so a second submission
  // (or someone guessing) returns 410 Gone rather than letting another finalize fire.
  if (!booking.invoiceDetailsToken || booking.invoiceDetailsToken !== token) {
    if (!booking.invoiceDetailsToken && booking.paymentStatus !== "PENDING") {
      return new NextResponse("This booking has already been confirmed.", { status: 410 });
    }
    return new NextResponse("Invalid or expired link.", { status: 403 });
  }
  if (booking.status === "CANCELLED") {
    return new NextResponse("This booking has been cancelled.", { status: 409 });
  }
  if (booking.paymentMethod !== "INVOICE") {
    return new NextResponse("This booking isn't an invoice-method booking.", { status: 409 });
  }

  const json = await request.json().catch(() => null);
  const parsed = invoiceDetailsSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new NextResponse(
      `${issue?.path?.join(".") ?? "body"}: ${issue?.message ?? "invalid"}`,
      { status: 400 },
    );
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      invoiceDetails: parsed.data as unknown as Prisma.InputJsonValue,
      paymentStatus: "INVOICE_PENDING",
      invoiceDetailsToken: null,
    },
  });

  // When the reservation was already confirmed at host-initiated time (default flow), the
  // Google event + standard confirmation email are already in place — skip the finalize call.
  // The strict flow (requirePayment=true) leaves googleEventId null until here, so we still
  // need to finalize for that path.
  if (!booking.googleEventId) {
    const result = await finalizeBooking({
      bookingId: booking.id,
      hostId: booking.hostId,
      collectiveCoHostIds: [],
      inviteeTimezone: "UTC",
    });
    if (!result.ok) {
      return new NextResponse(result.message, { status: result.status });
    }
  }

  // Mirror the public-flow invoice path: if the host opted into Soul-Suite-issued invoices,
  // kick off the auto-generated invoice + Stripe payment link. Failures are logged; the
  // host can retry from the Payments page.
  if (booking.host.invoiceSource === "SOUL_SUITE") {
    const inv = await sendSoulSuiteInvoice({ bookingId: booking.id });
    if (!inv.ok) {
      console.warn("[host-bookings] Soul Suite invoice send failed", {
        bookingId: booking.id,
        reason: inv.reason,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
