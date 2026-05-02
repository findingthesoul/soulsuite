-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- AlterTable: Host
ALTER TABLE "Host" ADD COLUMN "stripeAccountId" TEXT;

-- AlterTable: MeetingType
ALTER TABLE "MeetingType" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "MeetingType" ADD COLUMN "priceCurrency" TEXT;

-- AlterTable: Booking
ALTER TABLE "Booking" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Booking" ADD COLUMN "stripeSessionId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "stripePaymentIntent" TEXT;

-- CreateIndex
CREATE INDEX "Booking_stripeSessionId_idx" ON "Booking"("stripeSessionId");
