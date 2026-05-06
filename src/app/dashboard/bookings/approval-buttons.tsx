"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Inline Approve / Decline pair shown on PENDING_APPROVAL bookings in the dashboard list.
// Hits /api/admin/bookings/[id]/{approve,decline}; refreshes the page on success.

export function ApprovalButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: "approve" | "decline") {
    if (action === "decline" && !confirm("Decline this request? The invitee will be notified.")) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        alert(msg || `Failed to ${action}.`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        onClick={() => act("approve")}
        disabled={pending}
        aria-label="Approve booking"
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => act("decline")}
        disabled={pending}
        aria-label="Decline booking"
      >
        Decline
      </Button>
    </div>
  );
}
