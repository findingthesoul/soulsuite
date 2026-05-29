-- Split the single Host.personalRoomUrl column into per-platform slots and rewire existing
-- PERSONAL_ROOM meeting types to PERSONAL_ZOOM_ROOM. Rationale: hosts wanted a Teams personal
-- room alongside their Zoom room — one column couldn't hold both.

ALTER TABLE "Host" ADD COLUMN "personalZoomRoomUrl" TEXT;
ALTER TABLE "Host" ADD COLUMN "personalTeamsRoomUrl" TEXT;

-- Migrate existing personal rooms into the Zoom slot. Anyone who actually had a Teams URL there
-- can move it manually via Profile settings; the assumption matches every known caller today.
UPDATE "Host"
SET "personalZoomRoomUrl" = "personalRoomUrl"
WHERE "personalRoomUrl" IS NOT NULL;

-- Repoint every meeting type that was on the legacy generic PERSONAL_ROOM provider. Picks Zoom
-- because that's where the URL value lived in practice.
UPDATE "MeetingType"
SET "conferencingProvider" = 'PERSONAL_ZOOM_ROOM'
WHERE "conferencingProvider" = 'PERSONAL_ROOM';

ALTER TABLE "Host" DROP COLUMN "personalRoomUrl";
