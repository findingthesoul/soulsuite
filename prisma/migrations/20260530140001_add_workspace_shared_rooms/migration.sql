-- Shared persistent meeting rooms at the workspace level. Mirrors the personal-room split:
-- one slot per platform so a team can publish a single company Zoom room and a company Teams
-- room, then point meeting types at whichever fits the audience.

ALTER TABLE "Workspace" ADD COLUMN "sharedZoomRoomUrl" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "sharedTeamsRoomUrl" TEXT;
