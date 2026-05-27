// POST /api/admin/bookings/[id]/credit-invoice
//
// Voids the invoice for a cancelled INVOICE-method booking. Used when a booking is cancelled
// and no payment has been collected yet — the host needs to issue a credit note (or, for a
// Soul-Suite-issued invoice, simply deactivate the still-open payment link).
//
// Allowed states: paymentMethod = INVOICE, paymentStatus in [INVOICE_PENDING, INVOICE_SENT],
// status = CANCELLED. Idempotent — repeating with paymentStatus = INVOICE_VOIDED returns 200.
//
// Side effects:
//   - SOUL_SUITE invoices: deactivate the Stripe payment link (best-effort; logged on failure).
//   - Email the billing address with the void notice.
//   - Flip paymentStatus → INVOICE_VOIDED.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";
import { deactivateInvoicePaymentLink } from "@/lib/stripe/payment-link";
import { invoiceVoidedTemplate, sendEmailAfterResponse } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { formatPrice } from "@/lib/stripe/client";
import { invoiceDetailsSchema } from "@/lib/bookings/invoice-details";
import { resolveRecipientTimezone } from "@/lib/recipient-timezone";
import { workspaceIdForMeetingType } from "@/lib/contacts";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await authorizeAdminBookingAction(caller, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  const { booking } = access.data;

  if (booking.paymentMethod !== "INVOICE") {
    return NextResponse.json(
      { error: "Only invoice bookings can be credited" },
      { status: 409 },
    );
  }
  if (booking.paymentStatus === "INVOICE_VOIDED") {
    return NextResponse.json({ ok: true, alreadyVoided: true });
  }
  if (
    booking.paymentStatus !== "INVOICE_PENDING" &&
    booking.paymentStatus !== "INVOICE_SENT"
  ) {
    return NextResponse.json(
      { error: "Invoice is already paid or in a non-creditable state" },
      { status: 409 },
    );
  }
  if (booking.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Cancel the booking before crediting the invoice" },
      { status: 409 },
    );
  }

  // Reload the full booking — admin-access only selects the columns it needs for auth, and we
  // need invoiceDetails / invoicePaymentLinkId / meetingType pricing here.
  const full = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: {
      meetingType: { select: { name: true, priceCents: true, priceCurrency: true } },
      host: { select: { name: true, email: true, stripeAccountId: true, invoiceSource: true, timezone: true } },
    },
  });
  if (!full) return NextResponse.json({ error: "booking not found" }, { status: 404 });

  let paymentLinkDeactivated = false;
  if (
    full.host.invoiceSource === "SOUL_SUITE" &&
    full.invoicePaymentLinkId &&
    full.host.stripeAccountId
  ) {
    try {
      await deactivateInvoicePaymentLink(
        full.host.stripeAccountId,
        full.invoicePaymentLinkId,
      );
      paymentLinkDeactivated = true;
    } catch (err) {
      console.warn("[credit-invoice] deactivate payment link failed", err);
    }
  }

  await prisma.booking.update({
    where: { id: full.id },
    data: { paymentStatus: "INVOICE_VOIDED" },
  });

  // Best-effort email — failures don't roll back the void.
  const billing = invoiceDetailsSchema.safeParse(full.invoiceDetails);
  if (
    billing.success &&
    full.meetingType.priceCents != null &&
    full.meetingType.priceCurrency
  ) {
    const tpl = invoiceVoidedTemplate({
      hostName: full.host.name,
      workspaceName: "",
      invoiceNumber: full.invoiceNumber,
      meetingTypeName: full.meetingType.name,
      startsAtIso: full.startsAt.toISOString(),
      endsAtIso: full.endsAt.toISOString(),
      inviteeName: full.inviteeName,
      formattedPrice: formatPrice(full.meetingType.priceCents, full.meetingType.priceCurrency),
      paymentLinkDeactivated,
      billingEmail: billing.data.billingEmail,
      logoUrl: await getEmailLogoUrl(),
      timezone: await resolveRecipientTimezone({
        email: billing.data.billingEmail,
        workspaceId: await workspaceIdForMeetingType(full.meetingTypeId),
        fallback: full.host.timezone,
      }),
    });
    sendEmailAfterResponse({
      to: billing.data.billingEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      fromName: full.host.name,
      replyTo: full.host.email,
    });
  }

  return NextResponse.json({ ok: true, paymentLinkDeactivated });
}
