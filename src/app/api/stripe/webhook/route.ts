// Stripe webhook receiver. Verifies the signature against STRIPE_WEBHOOK_SECRET and reacts to:
//   - checkout.session.completed     → mark Booking PAID and run finalizeBooking()
//   - checkout.session.expired       → mark Booking FAILED, soft-cancel
//   - payment_intent.payment_failed  → mark Booking FAILED
//
// Connect note: events for direct charges arrive on the *connected* account. We don't filter
// by account here — the Booking row's stripeSessionId lookup is sufficient to resolve.
//
// Idempotency: Stripe re-delivers events on 5xx. finalizeBooking() is idempotent (it short-
// circuits when googleEventId is already set), and the PAID flip is conditional on the current
// status so duplicate deliveries don't double-fire side effects.

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripeClient, isStripeConfigured } from "@/lib/stripe/client";
import { serverEnv } from "@/lib/env";
import { finalizeBooking } from "@/lib/bookings/finalize";

export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return new NextResponse("Stripe not configured", { status: 503 });
  }
  const env = serverEnv();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new NextResponse("Webhook secret not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new NextResponse("Missing stripe-signature header", { status: 400 });
  }

  // The raw body is required for HMAC verification — Next gives us a Web Request, so we read text.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await handleSessionFailed(
          (event.data.object as Stripe.Checkout.Session).id,
          "EXPIRED",
        );
        break;
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // We don't have stripePaymentIntent on the Booking yet at PENDING time, so look up via
        // the latest checkout session for this PI when present in the event.
        const sessions = await stripeClient().checkout.sessions.list({
          payment_intent: pi.id,
          limit: 1,
        });
        const sess = sessions.data[0];
        if (sess) await handleSessionFailed(sess.id, "PAYMENT_FAILED");
        break;
      }
      default:
        // Other events (charge.*, etc.) are not part of the booking lifecycle for v1.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler failed", err);
    // Returning 500 prompts Stripe to retry — appropriate for transient infra errors.
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleSessionCompleted(session: Stripe.Checkout.Session) {
  // Soul-Suite-issued invoice payment links carry metadata.kind = "invoice" + bookingId. Their
  // checkout sessions never had stripeSessionId stored on the Booking (we only know the link id),
  // so route on metadata first.
  if (session.metadata?.kind === "invoice" && session.metadata.bookingId) {
    await handleInvoicePaid(session);
    return;
  }

  const sessionId = session.id;
  const booking = await prisma.booking.findFirst({
    where: { stripeSessionId: sessionId },
    include: { meetingType: true },
  });
  if (!booking) {
    console.warn("[stripe webhook] no Booking found for session", sessionId);
    return;
  }
  if (booking.paymentStatus === "PAID") {
    return; // Idempotent: already handled.
  }

  // Resolve collective co-hosts the same way the bookings API did. For SINGLE/ROUND_ROBIN we
  // pass an empty list. We re-derive from MeetingType.assignedHostIds vs. the booked host.
  const coHostIds =
    booking.meetingType.routingMode === "COLLECTIVE"
      ? booking.meetingType.assignedHostIds.filter((id) => id !== booking.hostId)
      : [];

  // Pull invitee timezone out of session metadata (set when creating the session). Falls back
  // to the host's timezone for the contact upsert if missing.
  const inviteeTimezone =
    (session.metadata?.inviteeTimezone as string | undefined) ?? "UTC";

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: "PAID",
      stripePaymentIntent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    },
  });

  const result = await finalizeBooking({
    bookingId: booking.id,
    hostId: booking.hostId,
    collectiveCoHostIds: coHostIds,
    inviteeTimezone,
  });
  if (!result.ok) {
    // Finalization failed (Google/Zoom). The booking row was deleted by finalize on hard
    // failures — but the invitee already paid. Log loudly so we can manually reconcile / refund.
    console.error(
      "[stripe webhook] finalizeBooking failed for paid booking",
      booking.id,
      result,
    );
  }
}

// Soul-Suite invoice payment-link completion. The Booking was already finalized at creation
// time (Google event + confirmation email), so we just flip paymentStatus to PAID and stash the
// payment intent for the audit trail. No finalizeBooking call here.
async function handleInvoicePaid(session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    console.warn("[stripe webhook] no Booking for invoice payment", bookingId);
    return;
  }
  if (booking.paymentStatus === "PAID") return;
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: "PAID",
      stripePaymentIntent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      stripeSessionId: session.id,
    },
  });
}

async function handleSessionFailed(sessionId: string, reason: "EXPIRED" | "PAYMENT_FAILED") {
  const booking = await prisma.booking.findFirst({ where: { stripeSessionId: sessionId } });
  if (!booking) return;
  if (booking.paymentStatus === "PAID") return; // Late retry of an already-completed flow.
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: "FAILED",
      status: "CANCELLED",
    },
  });
  console.info(`[stripe webhook] booking ${booking.id} marked FAILED (${reason})`);
}
