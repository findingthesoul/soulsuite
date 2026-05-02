-- AlterTable
ALTER TABLE "MeetingType" ADD COLUMN "conferencingHostId" TEXT;

-- AddForeignKey
ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_conferencingHostId_fkey" FOREIGN KEY ("conferencingHostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
