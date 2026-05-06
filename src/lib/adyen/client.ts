// Minimal Adyen Pay-by-Link client. Implemented with fetch (no Adyen Node SDK dep) since we
// only need three calls: create payment link, verify webhook HMAC, and (future) issue refund.
// All endpoints live under ADYEN_BASE_URL (e.g. https://checkout-test.adyen.com for test,
// https://{prefix}-checkout-live.adyenpayments.com for live).
//
// The platform model: Soul Suite is the merchant of record under our master Adyen account.
// Each host has a sub-merchant account name (Host.adyenMerchantAccount) which we pass on the
// payment link request so payouts go to the right entity.

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

export function isAdyenConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.ADYEN_API_KEY && env.ADYEN_BASE_URL);
}

interface CreatePaymentLinkArgs {
  merchantAccount: string;
  amount: { value: number; currency: string }; // value in minor units, currency uppercase ISO-4217
  reference: string; // our booking id — round-trips back on the notification
  description?: string;
  shopperEmail?: string;
  shopperName?: { firstName?: string; lastName?: string };
  returnUrl: string;
  expiresAt: Date; // Adyen requires future ISO date; max 70 days
}

export interface AdyenPaymentLink {
  id: string;
  url: string;
  expiresAt: string;
}

export async function createPaymentLink(args: CreatePaymentLinkArgs): Promise<AdyenPaymentLink> {
  const env = serverEnv();
  if (!env.ADYEN_API_KEY || !env.ADYEN_BASE_URL) {
    throw new Error("Adyen is not configured (ADYEN_API_KEY / ADYEN_BASE_URL missing).");
  }
  const base = env.ADYEN_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/v71/paymentLinks`, {
    method: "POST",
    headers: {
      "x-api-key": env.ADYEN_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      merchantAccount: args.merchantAccount,
      amount: { value: args.amount.value, currency: args.amount.currency.toUpperCase() },
      reference: args.reference,
      description: args.description,
      shopperEmail: args.shopperEmail,
      shopperName: args.shopperName,
      returnUrl: args.returnUrl,
      expiresAt: args.expiresAt.toISOString(),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Adyen paymentLinks failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text) as { id: string; url: string; expiresAt: string };
  return { id: json.id, url: json.url, expiresAt: json.expiresAt };
}

// HMAC verification for Adyen notifications. The signing string is built from the notification
// item's fields in a specific order and HMAC-SHA256'd with the binary HMAC key from Customer Area.
// See https://docs.adyen.com/development-resources/webhooks/verify-hmac-signatures
export function verifyNotificationHmac(item: Record<string, unknown>, hmacKeyHex: string): boolean {
  const sig = (item.additionalData as Record<string, string> | undefined)?.hmacSignature;
  if (!sig) return false;
  const fields = [
    str(item.pspReference),
    str(item.originalReference),
    str(item.merchantAccountCode),
    str(item.merchantReference),
    String((item.amount as { value?: unknown } | undefined)?.value ?? ""),
    String((item.amount as { currency?: unknown } | undefined)?.currency ?? ""),
    str(item.eventCode),
    str(item.success),
  ];
  const data = fields.map(escapeField).join(":");
  const key = Buffer.from(hmacKeyHex, "hex");
  const expected = createHmac("sha256", key).update(data, "utf8").digest("base64");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

function escapeField(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

// Currency exponents for the few we surface. Adyen takes minor units; for EUR/USD/GBP that's
// cents (×100), but ZAR is also ×100. JPY and others would be ×1 — add when we surface them.
export function toMinorUnits(majorOrCents: number, currency: string): number {
  // Our schema already stores priceCents in minor units for two-decimal currencies, so this is
  // the identity for EUR/USD/GBP/ZAR. Kept as a function so a future zero-decimal currency is a
  // single line to add.
  void currency;
  return majorOrCents;
}
