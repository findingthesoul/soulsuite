-- CreateEnum
CREATE TYPE "ConferencingProvider" AS ENUM ('GOOGLE_MEET', 'ZOOM', 'TEAMS', 'NONE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "conferencingProvider" "ConferencingProvider" NOT NULL DEFAULT 'GOOGLE_MEET',
ADD COLUMN     "meetUrl" TEXT,
ADD COLUMN     "providerMeetingId" TEXT;

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "zoomAccountEmail" TEXT,
ADD COLUMN     "zoomConnectedAt" TIMESTAMP(3),
ADD COLUMN     "zoomRefreshToken" TEXT;

-- AlterTable
ALTER TABLE "MeetingType" ADD COLUMN     "conferencingProvider" "ConferencingProvider" NOT NULL DEFAULT 'GOOGLE_MEET';
