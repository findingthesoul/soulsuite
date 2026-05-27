-- DAILY_DIGEST notify mode + reminder stamp for the per-invitee cron.

ALTER TYPE "PollNotifyMode" ADD VALUE IF NOT EXISTS 'DAILY_DIGEST';

ALTER TABLE "Poll"
  ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
