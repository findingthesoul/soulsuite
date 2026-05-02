"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";

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
 * - `variant="edit"`: direct-edit; sticky Save in the page header, Discard reverts.
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

  const start = initialSelections(calendars, saved);
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<Record<string, Selection>>(start);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const writeCount = Object.values(draft).filter((v) => v === "write").length;
  const canSubmit = writeCount === 1 && !pending;

  function setRole(id: string, next: Selection) {
    const updated = { ...draft, [id]: next };
    if (next === "write") {
      // Exactly one write target.
      for (const k of Object.keys(updated)) {
        if (k !== id && updated[k] === "write") updated[k] = "conflict";
      }
    }
    setDraft(updated);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const body = Object.entries(draft)
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
        commit(draft);
        router.refresh();
      } else {
        router.push("/onboarding/working-hours");
      }
    });
  }

  const editor = (
    <Card>
      <CardHeader>
        <CardTitle>Connected calendars</CardTitle>
        <CardDescription>
          Conflict sources block availability; the write target receives new bookings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="rounded-md border border-border divide-y divide-border">
          {calendars.map((cal) => {
            const role = draft[cal.id];
            return (
              <li key={cal.id} className="flex items-center justify-between gap-4 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{cal.summary}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cal.primary ? "Primary · " : ""}
                    {cal.accessRole ?? "—"}
                  </p>
                </div>
                <Select
                  value={role}
                  onChange={(e) => setRole(cal.id, e.target.value as Selection)}
                  className="w-44"
                >
                  <option value="off">Ignore</option>
                  <option value="conflict">Conflict source</option>
                  <option value="write">Write target</option>
                </Select>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );

  if (isEdit) {
    return (
      <div className="space-y-4">
        <DirtyNavGuard dirty={dirty && writeCount === 1} onSave={submit} />
        <PageHeader
          title="Calendars"
          description="Pick which Google calendars block availability and where new bookings get created."
          actions={
            <SaveBar
              dirty={dirty && writeCount === 1}
              pending={pending}
              onSave={submit}
              onDiscard={() => {
                reset();
                setError(null);
              }}
            />
          }
        />
        {editor}
        {dirty && writeCount !== 1 && (
          <p className="text-xs text-accent">
            Pick exactly one write target — that&apos;s where new bookings get created.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Onboarding variant: linear flow with a bottom Continue button.
  return (
    <div className="space-y-4">
      {editor}
      {writeCount !== 1 && (
        <p className="text-xs text-accent">
          Pick exactly one write target — that&apos;s where new bookings get created.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
