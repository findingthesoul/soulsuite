-- Email send log + status enum. Every sendEmail() call writes one row so the diagnostics
-- page can tell missing Resend creds (SKIPPED) from Resend rejections (FAILED) from
-- successful sends (SENT) — without scraping Function logs.

CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "EmailLog" (
  "id"         TEXT NOT NULL,
  "toEmail"    TEXT NOT NULL,
  "fromHeader" TEXT NOT NULL,
  "subject"    TEXT NOT NULL,
  "status"     "EmailStatus" NOT NULL,
  "reason"     TEXT,
  "bookingId"  TEXT,
  "hostId"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailLog_toEmail_createdAt_idx" ON "EmailLog"("toEmail", "createdAt");
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");
CREATE INDEX "EmailLog_bookingId_idx" ON "EmailLog"("bookingId");
