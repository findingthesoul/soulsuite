-- Drop the Adyen-specific columns added in 20260507120000_add_adyen.
-- Adyen declined to onboard the platform, so the integration is dropped.
-- The PaymentMethod enum value 'ADYEN' is intentionally left in place — Postgres can't drop
-- enum values without recreating the type, and the value is no longer produced anywhere.

ALTER TABLE "Host" DROP COLUMN IF EXISTS "adyenMerchantAccount";

DROP INDEX IF EXISTS "Booking_adyenPaymentLinkId_idx";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "adyenPaymentLinkId";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "adyenPaymentLinkUrl";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "adyenPspReference";
