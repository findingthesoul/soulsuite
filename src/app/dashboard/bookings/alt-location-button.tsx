"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog";

// Per-booking "Alternative location" affordance. Appears as a small inline button next to each
// upcoming booking row. Click → modal with a single Input. Save PATCHes the booking; Cancel
// closes without changes. Empty input reverts to provider-generated.

interface Props {
  bookingId: string;
  initial: string | null;
  hint: string | null;
}

export function AltLocationButton({ bookingId, initial, hint }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openDialog(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setValue(initial ?? "");
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    const trimmed = value.trim();
    if (trimmed.length > 500) {
      setError("Too long (max 500 characters).");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/bookings/${bookingId}/alt-location`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alternativeLocation: trimmed.length > 0 ? trimmed : null }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const hasOverride = (initial ?? "").trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title={hasOverride ? "Edit alternative location" : "Set alternative location"}
        aria-label={hasOverride ? "Edit alternative location" : "Set alternative location"}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
      >
        <MapPin className="h-3 w-3" />
        {hasOverride ? "Location overridden" : "Location"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader
          title="Alternative location"
          description="Override the location for this booking only. Leave empty to revert to the original."
          onClose={() => setOpen(false)}
        />
        <DialogBody>
          {hint && (
            <p className="text-xs text-muted-foreground">
              Original: <span className="text-foreground whitespace-pre-line">{hint}</span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="altLocation">Location</Label>
            <Input
              id="altLocation"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste a Zoom link, address, or room note"
              maxLength={500}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Updates the calendar event and notifies the invitee by email.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
