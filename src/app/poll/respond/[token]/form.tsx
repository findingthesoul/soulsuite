"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ProposedSlot, type VoteMap, type VoteValue } from "@/lib/polls";

export function VotingForm({
  token,
  slots,
  initialVotes,
}: {
  token: string;
  slots: ProposedSlot[];
  initialVotes: VoteMap;
}) {
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const [votes, setVotes] = useState<VoteMap>(initialVotes);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setVote(slotId: string, value: VoteValue) {
    setVotes((prev) => ({ ...prev, [slotId]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/polls/respond/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(votes),
      });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't save your votes.");
        return;
      }
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    });
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {slots.map((slot) => {
          const current = votes[slot.id];
          return (
            <li key={slot.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-sm font-medium text-foreground" suppressHydrationWarning>
                {formatRange(slot.startsAt, slot.endsAt, tz)}
              </p>
              <div className="mt-2 flex gap-2">
                <VoteButton active={current === "YES"} onClick={() => setVote(slot.id, "YES")}>
                  Yes
                </VoteButton>
                <VoteButton active={current === "MAYBE"} onClick={() => setVote(slot.id, "MAYBE")}>
                  Maybe
                </VoteButton>
                <VoteButton active={current === "NO"} onClick={() => setVote(slot.id, "NO")}>
                  No
                </VoteButton>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        {savedAt ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-green-600" /> Saved
          </p>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save votes"}
        </Button>
      </div>
    </div>
  );
}

function VoteButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-surface text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function formatRange(startsAt: string, endsAt: string, tz: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}
