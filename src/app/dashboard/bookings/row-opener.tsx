"use client";

import { useState, type ReactNode } from "react";
import {
  BookingDetailDialog,
  type BookingDetail,
} from "@/components/booking-detail-dialog";

// Thin client wrapper around a bookings-list row. Renders `children` inside a button that,
// on click, opens the shared BookingDetailDialog with this booking's data. Replaces the
// previous PrefetchLink that navigated to /{slug}/{mt}/confirmed/{id}; the dialog itself has
// an "Open booking page" button for cases where the host still wants the full page.

export function BookingRowOpener({
  booking,
  className,
  children,
}: {
  booking: BookingDetail;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <BookingDetailDialog
        booking={open ? booking : null}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
