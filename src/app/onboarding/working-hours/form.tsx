"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";

type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Range = { start: string; end: string };
type Schedule = Record<Day, Range[]>;

const DAYS: { key: Day; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_RANGE: Range = { start: "09:00", end: "17:00" };

function defaultSchedule(): Schedule {
  return {
    mon: [DEFAULT_RANGE],
    tue: [DEFAULT_RANGE],
    wed: [DEFAULT_RANGE],
    thu: [DEFAULT_RANGE],
    fri: [DEFAULT_RANGE],
    sat: [],
    sun: [],
  };
}

function timezoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const list =
    typeof intl.supportedValuesOf === "function"
      ? intl.supportedValuesOf("timeZone")
      : ["Europe/Amsterdam", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];
  return [...list].sort();
}

interface Initial {
  timezone: string;
  workingHours: Schedule | null;
}

interface Draft {
  timezone: string;
  schedule: Schedule;
}

/**
 * Dual-mode form:
 * - `variant="onboarding"` (default): linear flow, "Finish" button, redirects to dashboard.
 * - `variant="edit"`: direct-edit; sticky Save in the page header, Discard reverts.
 */
export function WorkingHoursForm({
  initial,
  variant = "onboarding",
}: {
  initial: Initial;
  variant?: "onboarding" | "edit";
}) {
  const router = useRouter();
  const isEdit = variant === "edit";
  const start: Draft = {
    timezone: initial.timezone,
    schedule: initial.workingHours ?? defaultSchedule(),
  };
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<Draft>(start);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tzs = timezoneOptions();

  function setRangeField(day: Day, idx: number, field: keyof Range, value: string) {
    setDraft({
      ...draft,
      schedule: {
        ...draft.schedule,
        [day]: draft.schedule[day].map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
      },
    });
  }

  function toggleDay(day: Day) {
    setDraft({
      ...draft,
      schedule: {
        ...draft.schedule,
        [day]: draft.schedule[day].length === 0 ? [DEFAULT_RANGE] : [],
      },
    });
  }

  // Append a new range. Default start = 1h after the previous range's end (or 13:00 fallback).
  function addRange(day: Day) {
    const existing = draft.schedule[day];
    const last = existing[existing.length - 1];
    const newStart = last ? bumpHour(last.end, 1) : "13:00";
    const newEnd = bumpHour(newStart, 1);
    setDraft({
      ...draft,
      schedule: { ...draft.schedule, [day]: [...existing, { start: newStart, end: newEnd }] },
    });
  }

  function removeRange(day: Day, idx: number) {
    setDraft({
      ...draft,
      schedule: { ...draft.schedule, [day]: draft.schedule[day].filter((_, i) => i !== idx) },
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/onboarding/working-hours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: draft.timezone, workingHours: draft.schedule }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      if (isEdit) {
        commit(draft);
        router.refresh();
      } else {
        router.push("/dashboard");
      }
    });
  }

  const editor = (
    <Card>
      <CardHeader>
        <CardTitle>Timezone &amp; weekly hours</CardTitle>
        <CardDescription>Your bookable windows in your local timezone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="tz">Timezone</Label>
          <Select id="tz" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
            {tzs.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </div>

        <div className="rounded-md border border-border divide-y divide-border">
          {DAYS.map(({ key, label }) => {
            const ranges = draft.schedule[key];
            const enabled = ranges.length > 0;
            return (
              <div key={key} className="flex items-start gap-3 p-3">
                <label className="flex w-32 shrink-0 items-center gap-2 text-sm font-medium pt-1.5">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(key)}
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                  {label}
                </label>
                <div className="flex flex-1 items-start">
                  {enabled ? (
                    <div className="flex flex-col gap-1.5 flex-1">
                      {ranges.map((r, idx) => (
                        <div key={idx} className="flex items-center gap-1 text-sm">
                          <Input
                            type="time"
                            value={r.start}
                            onChange={(e) => setRangeField(key, idx, "start", e.target.value)}
                            className="w-28"
                          />
                          <span className="text-muted-foreground">–</span>
                          <Input
                            type="time"
                            value={r.end}
                            onChange={(e) => setRangeField(key, idx, "end", e.target.value)}
                            className="w-28"
                          />
                          {ranges.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              type="button"
                              aria-label="Remove time block"
                              onClick={() => removeRange(key, idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => addRange(key)}
                        className="self-start text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" /> Add block
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-subtle-foreground pt-1.5">Unavailable</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  if (isEdit) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Availability"
          description="Timezone and weekly working hours."
          actions={
            <SaveBar
              dirty={dirty}
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
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Onboarding variant: linear flow with a bottom Finish button.
  return (
    <div className="space-y-6">
      {editor}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Finish"}
        </Button>
      </div>
    </div>
  );
}

// Add `delta` hours to a "HH:MM" string, clamped to 23:59. Used as a sensible default for new
// time blocks (lunch break, second shift, etc.).
function bumpHour(hhmm: string, delta: number): string {
  const [hStr, mStr] = hhmm.split(":");
  const total = Number(hStr) * 60 + Number(mStr) + delta * 60;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
