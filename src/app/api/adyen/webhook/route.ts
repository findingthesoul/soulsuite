// Adyen notification receiver. Adyen posts a JSON payload with one or more notificationItems
// per delivery; each item carries an HMAC signature in additionalData.hmacSignature that we
// verify against ADYEN_HMAC_KEY. We only react to AUTHORISATION events for now:
//   - eventCode=AUTHORISATION + success=true  → mark Booking PAID and run finalizeBooking()
//   - eventCode=AUTHORISATION + success=false → mark Booking FAILED
// Other events (CANCELLATION, REFUND, etc) are acknowledged with [accepted] but otherwise
// ignored — wire them up alongside the Adyen refund flow when that lands.
//
// Optional Basic Auth: Adyen Customer Area can require a username/password on the notification
// endpoint. When ADYEN_NOTIFICATION_USER + PASSWORD are set we validate the Authorization
// header before any work.
//
// Idempotency: AUTHORISATION can re-deliver after a 5xx; finalizeBooking is idempotent on
// googleEventId, and the PAID flip is conditional on the current paymentStatus.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { verifyNotificationHmac } from "@/lib/adyen/client";
import { finalizeBooking } from "@/lib/bookings/finalize";

interface NotificationItem {
  pspReference?: string;
  merchantReference?: string;
  eventCode?: string;
  success?: string;
  amount?: { value?: number; currency?: string };
  additionalData?: Record<string, string>;
}

export async function POST(request: NextRequest) {
  const env = serverEnv();
  if (!env.ADYEN_HMAC_KEY) {
    return new NextResponse("Adyen HMAC key not configured", { status: 503 });
  }

  if (env.ADYEN_NOTIFICATION_USER && env.ADYEN_NOTIFICATION_PASSWORD) {
    const auth = request.headers.get("authorization") ?? "";
    const expected =
      "Basic " +
      Buffer.from(`${env.ADYEN_NOTIFICATION_USER}:${env.ADYEN_NOTIFICATION_PASSWORD}`).toString(
        "base64",
      );
    if (auth !== expected) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as
    | { notificationItems?: { NotificationRequestItem: NotificationItem }[] }
    | null;
  const items = body?.notificationItems ?? [];

  for (const wrapped of items) {
    const item = wrapped.NotificationRequestItem;
    if (!item) continue;
    if (!verifyNotificationHmac(item as unknown as Record<string, unknown>, env.ADYEN_HMAC_KEY)) {
      // Reject the whole batch if any signature is bad — Adyen will retry.
      return new NextResponse("Bad HMAC", { status: 401 });
    }

    if (item.eventCode !== "AUTHORISATION") continue;
    const bookingId = item.merchantReference;
    if (!bookingId) continue;
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) continue;

    const success = String(item.success).toLowerCase() === "true";
    if (!success) {
      if (booking.paymentStatus === "PENDING") {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { paymentStatus: "FAILED" },
        });
      }
      continue;
    }

    if (booking.paymentStatus === "PAID") continue; // already finalised

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: "PAID",
        adyenPspReference: item.pspReference ?? booking.adyenPspReference,
      },
    });

    const result = await finalizeBooking({
      bookingId: booking.id,
      hostId: booking.hostId,
      collectiveCoHostIds: [],
      // Adyen doesn't echo the invitee's tz; UTC is a safe fallback for the contact upsert.
      inviteeTimezone: "UTC",
    });
    if (!result.ok) {
      console.error("[adyen] finalizeBooking failed", { bookingId: booking.id, result });
    }
  }

  // Adyen requires a literal "[accepted]" body to consider the notification delivered.
  return new NextResponse("[accepted]", { status: 200 });
}
