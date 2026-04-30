"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ProposedSlot, VoteMap } from "@/lib/polls";

interface ResponseRow {
  email: string;
  votes: VoteMap;
  inviteUrl: string;
  voted: boolean;
}
interface Tally {
  yes: number;
  maybe: number;
  no: number;
  pending: number;
}

export function PollDetailClient({
  pollId,
  status,
  slots,
  tally,
  responses,
}: {
  pollId: string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  slots: ProposedSlot[];
  tally: Record<string, Tally>;
  responses: ResponseRow[];
}) {
  const router = useRouter();
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const [picked, setPicked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function finalize() {
    if (!picked) return;
    if (!confirm("Finalize this slot? This creates a calendar invite for everyone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finalize", slotId: picked }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to finalize.");
        return;
      }
      router.refresh();
    });
  }

  function cancelPoll() {
    if (!confirm("Cancel this poll? Invitees can no longer vote.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        alert((await res.text()) || "Failed to cancel.");
        return;
      }
      router.refresh();
    });
  }

  const isOpen = status === "OPEN";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Votes</CardTitle>
          <CardDescription>
            {isOpen ? "Pick a winner once enough invitees have voted." : "Read-only — poll is closed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border -mx-1">
            {slots.map((slot) => {
              const t = tally[slot.id] ?? { yes: 0, maybe: 0, no: 0, pending: 0 };
              const isPicked = picked === slot.id;
              return (
                <li key={slot.id} className="px-1 py-3">
                  <button
                    type="button"
                    disabled={!isOpen}
                    onClick={() => setPicked(slot.id)}
                    className={`w-full text-left rounded-md px-3 py-3 transition-colors ${
                      isOpen
                        ? isPicked
                          ? "bg-foreground text-background"
                          : "hover:bg-surface-muted text-foreground"
                        : "text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium" suppressHydrationWarning>
                        {formatRange(slot.startsAt, slot.endsAt, tz)}
                      </span>
                      <span className="text-xs whitespace-nowrap">
                        <span className="font-medium">{t.yes}</span> yes
                        <span className="opacity-60"> · {t.maybe} maybe · {t.no} no · {t.pending} pending</span>
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isOpen && (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between gap-2">
            <Button variant="destructive" onClick={cancelPoll} disabled={pending}>
              Cancel poll
            </Button>
            <Button onClick={finalize} disabled={!picked || pending}>
              {pending ? "Finalizing…" : "Finalize selected slot"}
            </Button>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Invitees</CardTitle>
          <CardDescription>
            {isOpen
              ? "Send each link to its invitee — the link is private to that email."
              : "Voting closed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border -mx-1">
            {responses.map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{r.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.voted ? `${Object.keys(r.votes).length} votes` : "not yet voted"}
                  </p>
                </div>
                {isOpen && <CopyLinkButton url={r.inviteUrl} />}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard not available
    }
  }
  return (
    <Button variant="ghost" size="sm" type="button" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function formatRange(startsAt: string, endsAt: string, tz: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}
