-- AlterTable
ALTER TABLE "MeetingType" ADD COLUMN     "isOneOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OneOffSlot" (
    "id" TEXT NOT NULL,
    "meetingTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "bookedBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneOffSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OneOffSlot_bookedBookingId_key" ON "OneOffSlot"("bookedBookingId");

-- CreateIndex
CREATE INDEX "OneOffSlot_meetingTypeId_idx" ON "OneOffSlot"("meetingTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "OneOffSlot_meetingTypeId_startsAt_key" ON "OneOffSlot"("meetingTypeId", "startsAt");

-- AddForeignKey
ALTER TABLE "OneOffSlot" ADD CONSTRAINT "OneOffSlot_meetingTypeId_fkey" FOREIGN KEY ("meetingTypeId") REFERENCES "MeetingType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
