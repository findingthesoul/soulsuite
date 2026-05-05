-- Track per-host last dashboard visit so we can flag bookings created since then as "new".
ALTER TABLE "Host" ADD COLUMN "dashboardSeenAt" TIMESTAMP(3);
