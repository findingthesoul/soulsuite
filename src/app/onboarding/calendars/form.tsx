"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

type GoogleCalendar = { id: string; summary: string; primary: boolean; accessRole: string | null };
type SavedCalendar = { googleCalendarId: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" };
type Selection = "off" | "conflict" | "write";

function initialSelections(calendars: GoogleCalendar[], saved: SavedCalendar[]): Record<string, Selection> {
  const out: Record<string, Selection> = {};
  for (const cal of calendars) out[cal.id] = "off";
  for (const s of saved) {
    if (out[s.googleCalendarId] === undefined) continue;
    out[s.googleCalendarId] = s.role === "WRITE_TARGET" ? "write" : "conflict";
  }
  // If nothing saved yet, default the user's primary calendar to write target.
  if (saved.length === 0) {
    const primary = calendars.find((c) => c.primary);
    if (primary) out[primary.id] = "write";
  }
  return out;
}

export function CalendarPickerForm({
  calendars,
  saved,
}: {
  calendars: GoogleCalendar[];
  saved: SavedCalendar[];
}) {
  const router = useRouter();
  const [selections, setSelections] = useState(() => initialSelections(calendars, saved));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const writeCount = Object.values(selections).filter((v) => v === "write").length;
  const canSubmit = writeCount === 1 && !pending;

  function setRole(id: string, next: Selection) {
    setSelections((prev) => {
      const updated = { ...prev, [id]: next };
      if (next === "write") {
        // Exactly one write target.
        for (const k of Object.keys(updated)) {
          if (k !== id && updated[k] === "write") updated[k] = "conflict";
        }
      }
      return updated;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const body = Object.entries(selections)
        .filter(([, v]) => v !== "off")
        .map(([googleCalendarId, v]) => ({
          googleCalendarId,
          role: v === "write" ? "WRITE_TARGET" : "CONFLICT_CHECK",
          summary: calendars.find((c) => c.id === googleCalendarId)?.summary ?? null,
        }));
      const res = await fetch("/api/onboarding/calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendars: body }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || "Failed to save");
        return;
      }
      router.push("/onboarding/working-hours");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <ul className="divide-y divide-border">
          {calendars.map((cal) => (
            <li key={cal.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{cal.summary}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {cal.primary ? "Primary · " : ""}
                  {cal.accessRole ?? "—"}
                </p>
              </div>
              <Select
                value={selections[cal.id]}
                onChange={(e) => setRole(cal.id, e.target.value as Selection)}
                className="w-44"
              >
                <option value="off">Ignore</option>
                <option value="conflict">Conflict source</option>
                <option value="write">Write target</option>
              </Select>
            </li>
          ))}
        </ul>
      </Card>
      {writeCount !== 1 && (
        <p className="text-xs text-accent">
          Pick exactly one write target — that&apos;s where new bookings get created.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
