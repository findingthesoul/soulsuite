-- CreateIndex
CREATE INDEX "Booking_hostId_status_startsAt_idx" ON "Booking"("hostId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_meetingTypeId_startsAt_idx" ON "Booking"("meetingTypeId", "startsAt");

-- CreateIndex
CREATE INDEX "Poll_ownerHostId_status_idx" ON "Poll"("ownerHostId", "status");
