-- Move round-robin fairness from Project (per-team) to MeetingType (per-MT).
-- Two MTs on the same team can now legitimately use different rules.
--
-- Steps:
--   1. Add MeetingType.roundRobinFairness with the historic default.
--   2. Copy the value down from each MT's owning Project (so existing behaviour is preserved
--      to the row level) — only PROJECT-scoped MTs have a project to copy from.
--   3. Drop Project.roundRobinFairness.

ALTER TABLE "MeetingType"
  ADD COLUMN IF NOT EXISTS "roundRobinFairness" "RoundRobinFairness" NOT NULL DEFAULT 'LEAST_RECENTLY_ASSIGNED';

UPDATE "MeetingType" mt
SET "roundRobinFairness" = p."roundRobinFairness"
FROM "Project" p
WHERE mt."projectId" = p."id"
  AND mt."scope" = 'PROJECT';

ALTER TABLE "Project" DROP COLUMN IF EXISTS "roundRobinFairness";
