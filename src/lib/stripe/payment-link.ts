// Stripe Payment Link helper for invoice-method bookings (Soul Suite invoice delivery).
// We create a Price + PaymentLink on the connected account so funds go straight to the host.
// Metadata is attached at both the link and the on-completion checkout session level so the
// webhook can identify the booking and the "kind" (invoice vs upfront-stripe).

import { stripeClient } from "@/lib/stripe/client";

interface CreateInvoicePaymentLinkInput {
  stripeAccountId: string;
  bookingId: string;
  meetingTypeName: string;
  meetingTypeDescription?: string | null;
  invoiceNumber: string;
  priceCents: number;
  currency: string;
  redirectUrl: string;
  customerEmail?: string | null;
}

export interface InvoicePaymentLink {
  id: string;
  url: string;
}

export async function createInvoicePaymentLink(
  input: CreateInvoicePaymentLinkInput,
): Promise<InvoicePaymentLink> {
  const { stripeAccountId, bookingId, invoiceNumber } = input;
  const stripe = stripeClient();

  const price = await stripe.prices.create(
    {
      unit_amount: input.priceCents,
      currency: input.currency,
      product_data: {
        name: `${input.meetingTypeName} — ${invoiceNumber}`,
      },
    },
    { stripeAccount: stripeAccountId },
  );

  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        bookingId,
        kind: "invoice",
        invoiceNumber,
      },
      // Metadata on the resulting Checkout Session — the webhook reads this to find the booking
      // without having to look up the payment link itself.
      payment_intent_data: {
        metadata: {
          bookingId,
          kind: "invoice",
          invoiceNumber,
        },
      },
      after_completion: {
        type: "redirect",
        redirect: { url: input.redirectUrl },
      },
      ...(input.customerEmail
        ? { customer_creation: "if_required" as const }
        : {}),
    },
    { stripeAccount: stripeAccountId },
  );

  if (!link.url) throw new Error("Stripe payment link returned without a URL");

  return { id: link.id, url: link.url };
}

// Deactivate a previously-issued payment link. Used when re-issuing an invoice so the old link
// can no longer be used. Stripe doesn't delete payment links — `active: false` is the correct
// way to retire them.
export async function deactivateInvoicePaymentLink(
  stripeAccountId: string,
  paymentLinkId: string,
): Promise<void> {
  await stripeClient().paymentLinks.update(
    paymentLinkId,
    { active: false },
    { stripeAccount: stripeAccountId },
  );
}
