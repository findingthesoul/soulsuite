// POST /api/admin/bookings/[id]/refund
// Issues a full refund against the original PaymentIntent on the host's connected Stripe
// account (Connect Standard direct charge), then marks the Booking REFUNDED + CANCELLED.
//
// v1: full refund only. Idempotent in the sense that we refuse if paymentStatus is already
// REFUNDED (or anything other than PAID).
//
// Auth: workspace OWNER/ADMIN that can manage the booking's host, or the host themselves.

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripeClient, isStripeConfigured } from "@/lib/stripe/client";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
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

  if (booking.paymentStatus === "REFUNDED") {
    return NextResponse.json(
      { error: "Booking is already refunded" },
      { status: 409 },
    );
  }
  if (booking.paymentStatus !== "PAID") {
    return NextResponse.json(
      { error: "Booking is not in a PAID state; cannot refund" },
      { status: 409 },
    );
  }
  if (!booking.stripePaymentIntent) {
    return NextResponse.json(
      { error: "Booking has no PaymentIntent recorded" },
      { status: 409 },
    );
  }
  if (!booking.host.stripeAccountId) {
    return NextResponse.json(
      { error: "Host has no Stripe account on file" },
      { status: 409 },
    );
  }

  let refund: Stripe.Refund;
  try {
    refund = await stripeClient().refunds.create(
      { payment_intent: booking.stripePaymentIntent },
      { stripeAccount: booking.host.stripeAccountId },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe refund failed";
    console.error("[refund] stripe refunds.create failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: "REFUNDED",
      status: "CANCELLED",
    },
  });

  return NextResponse.json({ ok: true, refundId: refund.id });
}
