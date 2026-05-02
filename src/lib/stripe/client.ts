// Server-side Stripe SDK wrapper. Soul Suite uses Stripe Connect Standard direct charges:
// each host pastes their acct_ id in /settings/payments, and Checkout sessions are created on
// behalf of that account via the `stripeAccount` request option. The platform never holds funds.
//
// Lazy singleton so that environments without STRIPE_SECRET_KEY (dev / unconfigured) can still
// boot — the booking API fails closed with a clear message instead.

import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let _stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in env to enable paid meeting types.",
    );
  }
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      // Pin the API version so behaviour stays stable across SDK upgrades. Bump deliberately
      // and re-test webhook payloads when changing.
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]+$/;

export function isValidStripeAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}

// ISO-4217 lowercase. Limited to the ones we surface in the meeting type editor.
export const SUPPORTED_CURRENCIES = ["eur", "usd", "gbp"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

// Symbol for display on the public booking page. Keep tiny — no full Intl table for v1.
export function currencySymbol(code: string): string {
  switch (code.toLowerCase()) {
    case "eur":
      return "€";
    case "usd":
      return "$";
    case "gbp":
      return "£";
    default:
      return code.toUpperCase() + " ";
  }
}

export function formatPrice(priceCents: number, currency: string): string {
  const major = priceCents / 100;
  // Use en-US for predictable server-rendered HTML (matches client first paint).
  const formatted = major.toLocaleString("en-US", {
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(currency)}${formatted}`;
}
