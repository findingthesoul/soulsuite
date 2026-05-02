"use client";

// Reusable weekly-schedule editor. Same shape as Host.workingHours and
// MeetingType.workingHoursOverride: Record<Day, { start, end }[]>.
// Pure UI — controlled component; the parent owns state.

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Range = { start: string; end: string };
export type Schedule = Record<Day, Range[]>;

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

export function defaultSchedule(): Schedule {
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

export function emptySchedule(): Schedule {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

/** Coerce arbitrary JSON (or null) into a Schedule with the seven day keys present. */
export function coerceSchedule(input: unknown): Schedule {
  const empty = emptySchedule();
  if (!input || typeof input !== "object") return defaultSchedule();
  const obj = input as Record<string, unknown>;
  for (const { key } of DAYS) {
    const v = obj[key];
    if (Array.isArray(v)) {
      empty[key] = v
        .filter(
          (r): r is Range =>
            !!r &&
            typeof r === "object" &&
            typeof (r as Range).start === "string" &&
            typeof (r as Range).end === "string",
        )
        .map((r) => ({ start: r.start, end: r.end }));
    }
  }
  return empty;
}

export function WorkingHoursEditor({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (next: Schedule) => void;
}) {
  function setRangeField(day: Day, idx: number, field: keyof Range, v: string) {
    onChange({
      ...value,
      [day]: value[day].map((r, i) => (i === idx ? { ...r, [field]: v } : r)),
    });
  }

  function toggleDay(day: Day) {
    onChange({ ...value, [day]: value[day].length === 0 ? [DEFAULT_RANGE] : [] });
  }

  function addRange(day: Day) {
    const existing = value[day];
    const last = existing[existing.length - 1];
    const newStart = last ? bumpHour(last.end, 1) : "13:00";
    const newEnd = bumpHour(newStart, 1);
    onChange({ ...value, [day]: [...existing, { start: newStart, end: newEnd }] });
  }

  function removeRange(day: Day, idx: number) {
    onChange({ ...value, [day]: value[day].filter((_, i) => i !== idx) });
  }

  return (
    <div className="rounded-md border border-border divide-y divide-border">
      {DAYS.map(({ key, label }) => {
        const ranges = value[key];
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
  );
}

function bumpHour(hhmm: string, delta: number): string {
  const [hStr, mStr] = hhmm.split(":");
  const total = Number(hStr) * 60 + Number(mStr) + delta * 60;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
