-- Adyen support: Pay-by-Link integration alongside the existing Stripe Connect path.
-- Adds the new payment method, host-level merchant account ID, and per-booking Adyen state.

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ADYEN';

ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "adyenMerchantAccount" TEXT;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "adyenPaymentLinkId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "adyenPaymentLinkUrl" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "adyenPspReference" TEXT;

CREATE INDEX IF NOT EXISTS "Booking_adyenPaymentLinkId_idx" ON "Booking"("adyenPaymentLinkId");
