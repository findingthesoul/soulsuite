-- Persist theme preference on the Host row so it follows the user across browsers + devices.
-- localStorage still mirrors it for first-paint without an API roundtrip.

CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

ALTER TABLE "Host"
  ADD COLUMN IF NOT EXISTS "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';
