// PATCH /api/settings/stripe-account — host-owned Stripe Connect account ID.
// Accepts a string (acct_…) or null to disconnect. Format-validated server-side; we don't call
// Stripe to verify the account because that would require platform credentials configured here,
// and a malformed ID just causes the booking checkout to fail with a clear message.

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
  await prisma.host.update({
    where: { id: host.id },
    data: { stripeAccountId: value && value.length > 0 ? value : null },
  });
  return NextResponse.json({ ok: true });
}
