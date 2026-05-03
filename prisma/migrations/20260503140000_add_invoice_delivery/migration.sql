-- Invoice delivery: per-host source toggle + booking invoice fields + per-workspace numbering.

-- Enum
CREATE TYPE "InvoiceSource" AS ENUM ('EXTERNAL', 'SOUL_SUITE');

-- Host: invoiceSource
ALTER TABLE "Host"
  ADD COLUMN "invoiceSource" "InvoiceSource" NOT NULL DEFAULT 'EXTERNAL';

-- Booking: invoice delivery fields
ALTER TABLE "Booking"
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "invoicePaymentLinkUrl" TEXT,
  ADD COLUMN "invoicePaymentLinkId" TEXT,
  ADD COLUMN "invoiceSentAt" TIMESTAMP(3);

-- Per-workspace per-year invoice counter
CREATE TABLE "WorkspaceInvoiceCounter" (
  "workspaceId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastSeq" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceInvoiceCounter_pkey" PRIMARY KEY ("workspaceId", "year")
);
