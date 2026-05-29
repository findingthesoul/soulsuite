-- Add the workspace-level conferencing-provider enum values. Split from the column migration
-- because Postgres won't let a freshly added enum value be referenced in the same transaction.

ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'WORKSPACE_ZOOM_ROOM';
ALTER TYPE "ConferencingProvider" ADD VALUE IF NOT EXISTS 'WORKSPACE_TEAMS_ROOM';
