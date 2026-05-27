-- Poll owner notifications. Adds the mode + last-fired stamps so the vote handler can decide
-- whether to email the poll owner and skip duplicates.

CREATE TYPE "PollNotifyMode" AS ENUM ('FINAL_ONLY', 'EVERY_VOTE', 'NEVER');

ALTER TABLE "Poll"
  ADD COLUMN IF NOT EXISTS "notifyMode" "PollNotifyMode" NOT NULL DEFAULT 'FINAL_ONLY',
  ADD COLUMN IF NOT EXISTS "lastNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "allVotedNotifiedAt" TIMESTAMP(3);
