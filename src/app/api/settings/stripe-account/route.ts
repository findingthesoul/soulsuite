// PATCH /api/settings/stripe-account — host-owned Stripe Connect account ID + invoice delivery mode.
// stripeAccountId: string (acct_…) or null to disconnect. Format-validated server-side; we don't
// call Stripe to verify the account because that would require platform credentials configured
// here, and a malformed ID just causes the booking checkout to fail with a clear message.
// invoiceSource: EXTERNAL (host invoices from another app) or SOUL_SUITE (Soul Suite generates
// the invoice + Stripe payment link). SOUL_SUITE requires a connected Stripe account.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidStripeAccountId } from "@/lib/stripe/client";

const bodySchema = z.object({
  stripeAccountId: z
    .string()
    .trim()
    .nullable()
    .refine((v) => v === null || v === "" || isValidStripeAccountId(v), {
      message: "Stripe account ID must look like acct_xxx (letters and digits).",
    }),
  invoiceSource: z.enum(["EXTERNAL", "SOUL_SUITE"]).optional(),
  // Adyen sub-merchant account name on Soul Suite's platform. Allow letters/digits/._- up to
  // 80 chars; null clears it. Adyen's own constraints are stricter but those are enforced when
  // the payment link is created.
  adyenMerchantAccount: z
    .string()
    .trim()
    .nullable()
    .refine((v) => v === null || v === "" || /^[A-Za-z0-9._-]{1,80}$/.test(v), {
      message: "Adyen merchant account uses letters, digits, dot, dash, underscore (max 80 chars).",
    })
    .optional(),
});

export async function PATCH(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const value = parsed.data.stripeAccountId;
  const stripeAccountId = value && value.length > 0 ? value : null;
  const invoiceSource = parsed.data.invoiceSource ?? host.invoiceSource;

  if (invoiceSource === "SOUL_SUITE" && !stripeAccountId) {
    return new NextResponse(
      "Connect a Stripe account before enabling Soul Suite invoice delivery.",
      { status: 400 },
    );
  }

  const adyenRaw = parsed.data.adyenMerchantAccount;
  const adyenMerchantAccount =
    adyenRaw === undefined ? undefined : adyenRaw && adyenRaw.length > 0 ? adyenRaw : null;

  await prisma.host.update({
    where: { id: host.id },
    data: {
      stripeAccountId,
      invoiceSource,
      ...(adyenMerchantAccount !== undefined && { adyenMerchantAccount }),
    },
  });
  return NextResponse.json({ ok: true });
}
