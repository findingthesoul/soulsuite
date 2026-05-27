-- Token used by host-initiated INVOICE bookings: the invitee opens /billing/[id]?token=…
-- to fill in their billing details, which triggers finalize + flips paymentStatus to
-- INVOICE_PENDING. Token is cleared after a successful submission so the link is one-shot.

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "invoiceDetailsToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_invoiceDetailsToken_key"
  ON "Booking"("invoiceDetailsToken");
