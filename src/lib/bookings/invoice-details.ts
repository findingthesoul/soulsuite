// Invoice billing details — shape and zod schema reused on the public booking flow, the
// bookings POST API, and the admin Payments page (when rendering "what was captured").
//
// Kept deliberately small: v1 of the invoice flow only needs enough to print onto a manual
// invoice the host generates outside the app. PDF generation / VIES validation / reverse-charge
// VAT logic are explicitly out of scope for v1 (see soul-scheduler-brief.md).

import { z } from "zod";

// Country codes presented in the picker. "OTHER" expands to a free-text input on the client
// (stored in countryOther). Keep this list small — the brief only asked for NL/DE/BE/FR/UK/US +
// "Other"; expanding requires a UI tweak only, no schema migration.
export const SUPPORTED_BILLING_COUNTRIES = [
  "NL",
  "DE",
  "BE",
  "FR",
  "UK",
  "US",
  "OTHER",
] as const;

export type BillingCountry = (typeof SUPPORTED_BILLING_COUNTRIES)[number];

// Shape persisted on Booking.invoiceDetails. All trimmed strings; optional fields can be empty.
export const invoiceDetailsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160),
    billingEmail: z.string().trim().email().max(200),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional().default(""),
    postalCode: z.string().trim().min(1).max(40),
    city: z.string().trim().min(1).max(120),
    country: z.enum(SUPPORTED_BILLING_COUNTRIES),
    // Free-text fallback when country = OTHER. Required in that case (refine below); ignored
    // otherwise (we still persist it as empty string for shape stability).
    countryOther: z.string().trim().max(120).optional().default(""),
    vatId: z.string().trim().max(60).optional().default(""),
    reference: z.string().trim().max(120).optional().default(""),
  })
  .refine(
    (v) => v.country !== "OTHER" || v.countryOther.length > 0,
    { message: "Enter the country name.", path: ["countryOther"] },
  );

export type InvoiceDetails = z.infer<typeof invoiceDetailsSchema>;

// Human-readable single-line representation, used in confirmation email + admin Payments row.
export function formatInvoiceCountry(d: InvoiceDetails): string {
  return d.country === "OTHER" ? d.countryOther : d.country;
}
