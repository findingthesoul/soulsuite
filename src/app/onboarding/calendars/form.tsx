"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  // First-run: default the user's primary calendar to write target.
  if (saved.length === 0) {
    const primary = calendars.find((c) => c.primary);
    if (primary) out[primary.id] = "write";
  }
  return out;
}

/**
 * Dual-mode form:
 * - `variant="onboarding"` (default): linear flow, "Continue" button → /onboarding/working-hours.
 * - `variant="edit"`: read-only by default → Edit unlocks → Save persists / Cancel reverts.
 */
export function CalendarPickerForm({
  calendars,
  saved,
  variant = "onboarding",
}: {
  calendars: GoogleCalendar[];
  saved: SavedCalendar[];
  variant?: "onboarding" | "edit";
}) {
  const router = useRouter();
  const isEdit = variant === "edit";
  const [editing, setEditing] = useState(!isEdit);

  const [committed, setCommitted] = useState(() => initialSelections(calendars, saved));
  const [selections, setSelections] = useState(committed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const writeCount = Object.values(selections).filter((v) => v === "write").length;
  const canSubmit = writeCount === 1 && !pending;

  function startEdit() {
    setSelections(committed);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setSelections(committed);
    setError(null);
    setEditing(false);
  }

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
        setError((await res.text()) || "Failed to save");
        return;
      }
      if (isEdit) {
        setCommitted(selections);
        setEditing(false);
        router.refresh();
      } else {
        router.push("/onboarding/working-hours");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Connected calendars</CardTitle>
              <CardDescription>
                Conflict sources block availability; the write target receives new bookings.
              </CardDescription>
            </div>
            {isEdit && !editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ul className="rounded-md border border-border divide-y divide-border">
            {calendars.map((cal) => {
              const role = selections[cal.id];
              return (
                <li key={cal.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{cal.summary}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cal.primary ? "Primary · " : ""}
                      {cal.accessRole ?? "—"}
                    </p>
                  </div>
                  {editing ? (
                    <Select
                      value={role}
                      onChange={(e) => setRole(cal.id, e.target.value as Selection)}
                      className="w-44"
                    >
                      <option value="off">Ignore</option>
                      <option value="conflict">Conflict source</option>
                      <option value="write">Write target</option>
                    </Select>
                  ) : (
                    <span className="text-xs uppercase tracking-wide text-subtle-foreground">
                      {role === "write" ? "Write target" : role === "conflict" ? "Conflict source" : "Ignored"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {editing && writeCount !== 1 && (
        <p className="text-xs text-accent">
          Pick exactly one write target — that&apos;s where new bookings get created.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing && (
        <div className="flex justify-end gap-2">
          {isEdit && (
            <Button variant="secondary" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? "Saving…" : isEdit ? "Save" : "Continue"}
          </Button>
        </div>
      )}
    </div>
  );
}
