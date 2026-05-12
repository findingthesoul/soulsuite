-- Multi-tenant foundation: each workspace owns a primary email domain (enforced unique),
-- and Soul-Suite-level super-admins can provision new workspaces from /admin.
--
-- The unique constraint on Workspace.primaryEmailDomain ensures sign-in can route a user
-- to exactly one workspace by their email domain. The existing soul.com row is unaffected.

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_primaryEmailDomain_key" UNIQUE ("primaryEmailDomain");

ALTER TABLE "Host"
  ADD COLUMN IF NOT EXISTS "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
