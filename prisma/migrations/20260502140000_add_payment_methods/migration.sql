-- Adds per-meeting-type / per-booking payment method (Stripe vs invoice) and extends the
-- PaymentStatus enum so invoice bookings can advance through INVOICE_PENDING → INVOICE_SENT →
-- PAID without the row going through Stripe at all. Adyen is intentionally not added to the
-- enum yet — the UI surfaces it as a disabled placeholder; allowing the value at the DB layer
-- before there's any code path would be a footgun.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'INVOICE');

-- AlterEnum: PaymentStatus — extra states for invoice bookings.
ALTER TYPE "PaymentStatus" ADD VALUE 'INVOICE_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'INVOICE_SENT';

-- AlterTable: MeetingType
ALTER TABLE "MeetingType" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'STRIPE';

-- AlterTable: Booking
ALTER TABLE "Booking" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'STRIPE';
ALTER TABLE "Booking" ADD COLUMN "invoiceDetails" JSONB;
