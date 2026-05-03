-- Add IN_PERSON conferencing provider + per-MT defaultLocation + per-booking alternativeLocation.
-- Postgres requires ALTER TYPE ... ADD VALUE to be in its own transaction (or use IF NOT EXISTS).

ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'IN_PERSON';

ALTER TABLE "MeetingType" ADD COLUMN "defaultLocation" TEXT;

ALTER TABLE "Booking" ADD COLUMN "alternativeLocation" TEXT;
