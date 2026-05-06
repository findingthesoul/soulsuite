"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog";

// Inline Approve / Decline / Ask-for-alternative trio shown on PENDING_APPROVAL bookings.
// - Approve / Decline POST directly to the admin endpoints.
// - Ask for alternative opens a small dialog where the host writes an optional comment, then
//   POSTs to /request-alternative — the invitee gets an email with the comment + rebook link.

export function ApprovalButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [altOpen, setAltOpen] = useState(false);
  const [comment, setComment] = useState("");

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

  function submitAlternative() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/request-alternative`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        alert(msg || "Failed to send alternative request.");
        return;
      }
      setAltOpen(false);
      setComment("");
      router.refresh();
    });
  }

  return (
    <>
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
          onClick={() => setAltOpen(true)}
          disabled={pending}
          aria-label="Ask for an alternative time"
        >
          Alternative
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

      <Dialog open={altOpen} onOpenChange={(v) => !v && setAltOpen(false)}>
        <DialogHeader
          title="Ask for an alternative"
          description="The slot is released. The invitee gets an email with your note and a link to pick a new time."
          onClose={() => setAltOpen(false)}
        />
        <DialogBody className="space-y-3">
          <label htmlFor="alt-comment" className="block text-sm font-medium text-foreground">
            Note (optional)
          </label>
          <textarea
            id="alt-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="e.g. Friday morning doesn't work for me — could you try Tuesday or Wednesday afternoon?"
            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <p className="text-xs text-muted-foreground">{comment.length}/1000</p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setAltOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submitAlternative} disabled={pending}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
