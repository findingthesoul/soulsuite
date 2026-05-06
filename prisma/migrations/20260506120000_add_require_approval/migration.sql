-- Require-approval workflow: meeting types can require host approval before bookings confirm.
-- Booking status PENDING_APPROVAL holds the request until the host Approves (→ CONFIRMED via
-- finalize) or Declines (→ CANCELLED). New columns capture the workflow state.

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "requireApprovalDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MeetingType" ADD COLUMN IF NOT EXISTS "requireApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "approvalToken" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "approvalDecidedByHostId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_approvalToken_key" ON "Booking"("approvalToken");
