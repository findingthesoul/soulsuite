"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

interface SlotDraft {
  // For the form we keep date + time as separate strings the user types into. We assemble the
  // actual ISO timestamps at submit time, in the host's local browser timezone.
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
}

function blankSlot(): SlotDraft {
  return { date: "", time: "" };
}

export function NewPollForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [slots, setSlots] = useState<SlotDraft[]>(() => [blankSlot(), blankSlot()]);
  const [emailsText, setEmailsText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsedEmails = useMemo(
    () =>
      emailsText
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [emailsText],
  );

  function updateSlot(idx: number, patch: Partial<SlotDraft>) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("Name is required.");
    if (slots.length < 2) return setError("Add at least two proposed slots.");

    const proposedSlots: { id: string; startsAt: string; endsAt: string }[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.date || !s.time) return setError(`Slot ${i + 1}: date and time are required.`);
      const start = new Date(`${s.date}T${s.time}:00`);
      if (isNaN(start.getTime())) return setError(`Slot ${i + 1}: invalid date/time.`);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      proposedSlots.push({
        id: `slot-${i}-${Math.random().toString(36).slice(2, 8)}`,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
    }

    if (parsedEmails.length === 0) return setError("Add at least one invitee email.");
    const invalid = parsedEmails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalid) return setError(`Not a valid email: ${invalid}`);

    startTransition(async () => {
      const res = await fetch("/api/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          durationMinutes,
          proposedSlots,
          inviteeEmails: parsedEmails,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to create poll.");
        return;
      }
      const data = (await res.json()) as { id: string };
      router.push(`/dashboard/polls/${data.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name your poll and pick a duration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q2 planning sync"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duration">Duration</Label>
            <Select
              id="duration"
              value={String(durationMinutes)}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            >
              {DURATION_OPTIONS.map((m) => (
                <option key={m} value={String(m)}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed times</CardTitle>
          <CardDescription>At least 2. Times are interpreted in your local timezone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {slots.map((slot, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`date-${idx}`}>Date</Label>
                <Input
                  id={`date-${idx}`}
                  type="date"
                  value={slot.date}
                  onChange={(e) => updateSlot(idx, { date: e.target.value })}
                />
              </div>
              <div className="w-32 space-y-1.5">
                <Label htmlFor={`time-${idx}`}>Time</Label>
                <Input
                  id={`time-${idx}`}
                  type="time"
                  value={slot.time}
                  onChange={(e) => updateSlot(idx, { time: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="Remove slot"
                onClick={() => setSlots((prev) => prev.filter((_, i) => i !== idx))}
                disabled={slots.length <= 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setSlots((prev) => [...prev, blankSlot()])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a time
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitees</CardTitle>
          <CardDescription>One email per line, or comma-separated.</CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            rows={4}
            placeholder="alex@example.com&#10;blair@partner.example"
            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {parsedEmails.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {parsedEmails.length} invitee{parsedEmails.length === 1 ? "" : "s"}
            </p>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/dashboard/polls")} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Create poll"}
        </Button>
      </div>
    </div>
  );
}
