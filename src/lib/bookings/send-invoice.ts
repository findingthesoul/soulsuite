// Generate a Soul-Suite invoice for an INVOICE-method booking and email it to the billing
// address with a Stripe payment link. Idempotent on the booking row: if an invoice already
// exists, calling again resends the same invoice (does not allocate a new number) unless
// `regenerate` is set, which deactivates the old payment link and issues a new one.
//
// No-op when host.invoiceSource = EXTERNAL — the existing manual flow stays in charge.

import { prisma } from "@/lib/prisma";
import { invoiceEmailTemplate, sendEmail } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { formatPrice } from "@/lib/stripe/client";
import {
  createInvoicePaymentLink,
  deactivateInvoicePaymentLink,
} from "@/lib/stripe/payment-link";
import { nextInvoiceNumber } from "@/lib/bookings/invoice-number";
import { invoiceDetailsSchema, formatInvoiceCountry } from "@/lib/bookings/invoice-details";
import { publicEnv } from "@/lib/env";

interface SendInvoiceInput {
  bookingId: string;
  // When true: deactivate any existing payment link and issue a fresh one. Used by the admin
  // "Resend invoice" action when the host wants to retry. The invoice number is preserved.
  regenerate?: boolean;
}

interface SendInvoiceResult {
  ok: boolean;
  status: "sent" | "skipped" | "error";
  reason?: string;
  invoiceNumber?: string;
  paymentLinkUrl?: string;
}

export async function sendSoulSuiteInvoice(input: SendInvoiceInput): Promise<SendInvoiceResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      meetingType: true,
      host: true,
      project: true,
    },
  });
  if (!booking) return { ok: false, status: "error", reason: "booking not found" };

  if (booking.paymentMethod !== "INVOICE") {
    return { ok: false, status: "skipped", reason: "not an invoice booking" };
  }
  if (booking.host.invoiceSource !== "SOUL_SUITE") {
    return { ok: false, status: "skipped", reason: "host invoiceSource is EXTERNAL" };
  }
  if (!booking.host.stripeAccountId) {
    return { ok: false, status: "error", reason: "host has no Stripe account connected" };
  }
  if (!booking.invoiceDetails) {
    return { ok: false, status: "error", reason: "booking has no invoiceDetails" };
  }
  if (!booking.meetingType.priceCents || !booking.meetingType.priceCurrency) {
    return { ok: false, status: "error", reason: "meeting type has no price" };
  }
  if (booking.paymentStatus === "PAID") {
    return { ok: false, status: "skipped", reason: "already paid" };
  }

  const billing = invoiceDetailsSchema.safeParse(booking.invoiceDetails);
  if (!billing.success) {
    return { ok: false, status: "error", reason: "invoiceDetails failed validation" };
  }

  // Single-workspace assumption (matches getEmailLogoUrl). When multi-tenant lands, derive from
  // booking → host → workspaceMember.
  const workspace = await prisma.workspace.findFirst({
    select: { id: true, name: true },
  });
  if (!workspace) return { ok: false, status: "error", reason: "no workspace" };

  const regenerate = Boolean(input.regenerate);
  let invoiceNumber = booking.invoiceNumber;
  if (!invoiceNumber) {
    invoiceNumber = await prisma.$transaction((tx) => nextInvoiceNumber(workspace.id, tx));
  }

  if (regenerate && booking.invoicePaymentLinkId) {
    await deactivateInvoicePaymentLink(
      booking.host.stripeAccountId,
      booking.invoicePaymentLinkId,
    ).catch((err) => {
      console.warn("[invoice] deactivate old payment link failed", err);
    });
  }

  // Reuse existing payment link unless we're regenerating or there isn't one yet.
  let paymentLinkUrl = booking.invoicePaymentLinkUrl;
  let paymentLinkId = booking.invoicePaymentLinkId;
  if (regenerate || !paymentLinkUrl || !paymentLinkId) {
    const baseUrl = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    const slugForUrl = booking.project?.id
      ? (await prisma.project.findUnique({
          where: { id: booking.project.id },
          select: { slug: true },
        }))?.slug ?? booking.host.slug
      : booking.host.slug;
    const link = await createInvoicePaymentLink({
      stripeAccountId: booking.host.stripeAccountId,
      bookingId: booking.id,
      meetingTypeName: booking.meetingType.name,
      meetingTypeDescription: booking.meetingType.description,
      invoiceNumber,
      priceCents: booking.meetingType.priceCents,
      currency: booking.meetingType.priceCurrency,
      redirectUrl: `${baseUrl}/${slugForUrl}/${booking.meetingType.slug}/confirmed/${booking.id}?paid=1`,
      customerEmail: billing.data.billingEmail,
    });
    paymentLinkUrl = link.url;
    paymentLinkId = link.id;
  }

  const issuedAt = new Date();
  const formattedPrice = formatPrice(
    booking.meetingType.priceCents,
    booking.meetingType.priceCurrency,
  );

  const tpl = invoiceEmailTemplate({
    hostName: booking.host.name,
    workspaceName: workspace.name,
    invoiceNumber,
    issuedAt,
    meetingTypeName: booking.meetingType.name,
    startsAtIso: booking.startsAt.toISOString(),
    endsAtIso: booking.endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    priceCents: booking.meetingType.priceCents,
    currency: booking.meetingType.priceCurrency,
    formattedPrice,
    paymentLinkUrl,
    billing: {
      companyName: billing.data.companyName,
      billingEmail: billing.data.billingEmail,
      addressLine1: billing.data.addressLine1,
      addressLine2: billing.data.addressLine2 || undefined,
      postalCode: billing.data.postalCode,
      city: billing.data.city,
      countryLabel: formatInvoiceCountry(billing.data),
      vatId: billing.data.vatId || undefined,
      reference: billing.data.reference || undefined,
    },
    logoUrl: await getEmailLogoUrl(),
  });

  const send = await sendEmail({
    to: billing.data.billingEmail,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    fromName: booking.host.name,
    replyTo: booking.host.email,
  });

  // Persist link + number even if email failed, so a retry doesn't pile up Stripe payment
  // links. Status only flips to INVOICE_SENT on a successful send.
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      invoiceNumber,
      invoicePaymentLinkUrl: paymentLinkUrl,
      invoicePaymentLinkId: paymentLinkId,
      ...(send.ok
        ? { paymentStatus: "INVOICE_SENT", invoiceSentAt: issuedAt }
        : {}),
    },
  });

  if (!send.ok) {
    return {
      ok: false,
      status: "error",
      reason: `email send failed: ${send.reason ?? "unknown"}`,
      invoiceNumber,
      paymentLinkUrl,
    };
  }
  return { ok: true, status: "sent", invoiceNumber, paymentLinkUrl };
}
