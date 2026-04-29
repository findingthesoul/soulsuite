"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
        {calendars.map((cal) => (
          <li key={cal.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{cal.summary}</p>
              <p className="truncate text-xs text-neutral-500">
                {cal.primary ? "Primary · " : ""}
                {cal.accessRole ?? "—"}
              </p>
            </div>
            <select
              value={selections[cal.id]}
              onChange={(e) => setRole(cal.id, e.target.value as Selection)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            >
              <option value="off">Ignore</option>
              <option value="conflict">Conflict source</option>
              <option value="write">Write target</option>
            </select>
          </li>
        ))}
      </ul>
      {writeCount !== 1 && (
        <p className="text-xs text-amber-700">
          Pick exactly one write target — that&apos;s where new bookings get created.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-neutral-800"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
