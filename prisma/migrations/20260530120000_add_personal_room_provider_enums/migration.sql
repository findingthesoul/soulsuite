-- Add the two new conferencing-provider enum values BEFORE any DML that references them.
-- Postgres won't let a freshly-added enum value be used in the same transaction it was added
-- in, so we split this off into its own migration. The follow-up migration in
-- 20260530120001_split_personal_rooms then re-points existing PERSONAL_ROOM rows.

ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'PERSONAL_ZOOM_ROOM';
ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'PERSONAL_TEAMS_ROOM';
