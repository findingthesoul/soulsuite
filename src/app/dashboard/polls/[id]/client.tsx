"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus } from "lucide-react";
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

type NotifyMode = "FINAL_ONLY" | "EVERY_VOTE" | "DAILY_DIGEST" | "NEVER";

export function PollDetailClient({
  pollId,
  status,
  slots,
  tally,
  responses,
  notifyMode: initialNotifyMode,
}: {
  pollId: string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  slots: ProposedSlot[];
  tally: Record<string, Tally>;
  responses: ResponseRow[];
  notifyMode: NotifyMode;
}) {
  const router = useRouter();
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const [picked, setPicked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notifyMode, setNotifyMode] = useState<NotifyMode>(initialNotifyMode);
  const [notifyPending, startNotifyTransition] = useTransition();

  function changeNotifyMode(next: NotifyMode) {
    setNotifyMode(next);
    startNotifyTransition(async () => {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "updateSettings", notifyMode: next }),
      });
      if (!res.ok) {
        // Roll back the local toggle so the UI matches the server.
        setNotifyMode(initialNotifyMode);
        alert((await res.text()) || "Couldn't update notification mode.");
        return;
      }
      router.refresh();
    });
  }

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
        <Card>
          <CardHeader>
            <CardTitle>Email me about votes</CardTitle>
            <CardDescription>
              You can change this any time while the poll is open.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              {
                key: "FINAL_ONLY" as const,
                label: "When everyone has voted",
                hint: "One email when the last invitee submits.",
              },
              {
                key: "EVERY_VOTE" as const,
                label: "On every vote",
                hint: "One email per response.",
              },
              {
                key: "DAILY_DIGEST" as const,
                label: "Daily digest",
                hint: "One summary email per 24h while the poll is open.",
              },
              {
                key: "NEVER" as const,
                label: "Don't email me",
                hint: "Check the dashboard whenever you want.",
              },
            ].map((opt) => (
              <label
                key={opt.key}
                className={`flex items-start gap-2 cursor-pointer ${notifyPending ? "opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="notifyMode"
                  checked={notifyMode === opt.key}
                  onChange={() => changeNotifyMode(opt.key)}
                  disabled={notifyPending}
                  className="h-4 w-4 mt-0.5 border-border accent-foreground"
                />
                <span>
                  <span className="text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      )}

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
        <CardContent className="space-y-4">
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
          {isOpen && <AddInviteesForm pollId={pollId} />}
        </CardContent>
      </Card>
    </div>
  );
}

// Add-invitees form. Lives at the bottom of the Invitees card while the poll is open. Accepts
// a mix of comma- / space- / newline-separated emails so a quick paste from a calendar invite
// list works. Sends them to /api/polls/[id] with action=addInvitees; the server dedupes,
// creates fresh PollResponse rows + tokens, and emails the new invitees their private link.
function AddInviteesForm({ pollId }: { pollId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function parse(input: string): string[] {
    return Array.from(
      new Set(
        input
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
  }

  function submit() {
    setError(null);
    setNotice(null);
    const emails = parse(value);
    if (emails.length === 0) return setError("Enter at least one email.");
    const badly = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (badly) return setError(`"${badly}" doesn't look like an email.`);
    if (emails.length > 50) return setError("Add at most 50 invitees at a time.");
    startTransition(async () => {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "addInvitees", emails }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't add invitees.");
        return;
      }
      const data = (await res.json()) as { added: number; skipped: number };
      const added = data.added;
      const skipped = data.skipped;
      setNotice(
        added === 0
          ? "Everyone you added is already invited — no new invites sent."
          : `${added} invite${added === 1 ? "" : "s"} sent${skipped > 0 ? ` (${skipped} were already invited)` : ""}.`,
      );
      setValue("");
      if (added > 0) router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
        Add invitees
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted/40 p-3">
      <label htmlFor="add-invitees" className="block text-xs font-medium text-foreground">
        Add invitees
      </label>
      <textarea
        id="add-invitees"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder="email@example.com, another@example.com"
        className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-xs text-muted-foreground">
        Separate with commas, spaces, or new lines. Each new invitee gets a private vote link by
        email — anyone already on the poll is skipped silently.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-foreground">{notice}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => {
            setOpen(false);
            setValue("");
            setError(null);
            setNotice(null);
          }}
          disabled={pending}
        >
          Close
        </Button>
        <Button size="sm" type="button" onClick={submit} disabled={pending}>
          {pending ? "Sending…" : "Send invites"}
        </Button>
      </div>
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
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)} (${tz})`;
}
