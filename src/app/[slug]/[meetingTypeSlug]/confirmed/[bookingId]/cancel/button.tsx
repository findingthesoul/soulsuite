"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CancelButton({ bookingId, returnUrl }: { bookingId: string; returnUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
      if (!res.ok) {
        setError((await res.text()) || "Failed to cancel.");
        return;
      }
      router.push(returnUrl);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" onClick={cancel} disabled={pending}>
        {pending ? "Cancelling…" : "Cancel booking"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
