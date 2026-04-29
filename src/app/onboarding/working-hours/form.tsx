"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

// Best-effort browser TZ list. Falls back to a curated short list if Intl.supportedValuesOf is missing.
function timezoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") return intl.supportedValuesOf("timeZone");
  return ["Europe/Amsterdam", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];
}

export function WorkingHoursForm({
  initial,
}: {
  initial: { timezone: string; workingHours: Schedule | null };
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initial.timezone);
  const [schedule, setSchedule] = useState<Schedule>(initial.workingHours ?? defaultSchedule());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tzs = timezoneOptions();

  function setRangeField(day: Day, idx: number, field: keyof Range, value: string) {
    setSchedule((prev) => {
      const next = { ...prev, [day]: prev[day].map((r, i) => (i === idx ? { ...r, [field]: value } : r)) };
      return next;
    });
  }

  function toggleDay(day: Day) {
    setSchedule((prev) => ({ ...prev, [day]: prev[day].length === 0 ? [DEFAULT_RANGE] : [] }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/onboarding/working-hours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone, workingHours: schedule }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || "Failed to save");
        return;
      }
      router.push("/dashboard");
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="tz">Timezone</Label>
        <Select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {tzs.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <ul className="divide-y divide-border">
          {DAYS.map(({ key, label }) => {
            const ranges = schedule[key];
            const enabled = ranges.length > 0;
            return (
              <li key={key} className="flex items-center gap-3 p-4">
                <label className="flex w-32 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(key)}
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                  {label}
                </label>
                <div className="flex flex-1 items-center gap-2">
                  {enabled ? (
                    ranges.map((r, idx) => (
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
                      </div>
                    ))
                  ) : (
                    <span className="text-sm text-subtle-foreground">Unavailable</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Finish"}
        </Button>
      </div>
    </div>
  );
}
