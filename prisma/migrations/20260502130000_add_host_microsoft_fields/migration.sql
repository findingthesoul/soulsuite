-- AlterTable: add Microsoft Graph OAuth fields to Host (mirrors zoomRefreshToken et al).
ALTER TABLE "Host" ADD COLUMN     "microsoftRefreshToken" TEXT,
ADD COLUMN     "microsoftAccountEmail" TEXT,
ADD COLUMN     "microsoftConnectedAt" TIMESTAMP(3);
