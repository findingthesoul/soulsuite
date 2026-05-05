-- New PaymentStatus value for invoice cancellations where no money was collected.
-- Use ALTER TYPE so existing rows / app code keep working through the deploy.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'INVOICE_VOIDED';
