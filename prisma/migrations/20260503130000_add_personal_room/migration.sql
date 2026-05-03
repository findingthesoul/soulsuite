-- Add PERSONAL_ROOM conferencing provider + per-host personalRoomUrl. Hosts paste their
-- persistent room URL (Zoom PMI, Google Meet permanent room, Whereby, etc.) on /settings/profile;
-- meeting types with this provider hand the URL to invitees verbatim — no per-booking API call.
-- Postgres requires ALTER TYPE ... ADD VALUE outside a multi-statement transaction or with IF NOT EXISTS.

ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'PERSONAL_ROOM';

ALTER TABLE "Host" ADD COLUMN "personalRoomUrl" TEXT;
