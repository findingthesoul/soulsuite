"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";
import {
  WorkingHoursEditor,
  coerceSchedule,
  defaultSchedule,
  type Schedule,
} from "@/components/working-hours-editor";

interface DraftValues {
  workingHoursOverride: Schedule | null;
}

export function ProjectMemberAvailabilityForm({
  projectId,
  memberId,
  initialOverride,
}: {
  projectId: string;
  memberId: string;
  initialOverride: Schedule | null;
}) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<DraftValues>({
    workingHoursOverride: initialOverride,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(next: Schedule | null) {
    setDraft({ workingHoursOverride: next });
  }

  function save() {
    setError(null);
    const payload = serialiseOverride(draft.workingHoursOverride);
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}/working-hours`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingHoursOverride: payload }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit({ workingHoursOverride: draft.workingHoursOverride });
      router.refresh();
    });
  }

  const overrideOn = draft.workingHoursOverride !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        description="Custom working hours for this team only."
        actions={<SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={reset} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            Default uses the host&apos;s overall working hours. Override when this team should run
            on different hours than the host&apos;s default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="availabilityMode"
                checked={!overrideOn}
                onChange={() => update(null)}
                className="h-4 w-4 border-border accent-foreground"
              />
              Use default working hours
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="availabilityMode"
                checked={overrideOn}
                onChange={() => update(defaultSchedule())}
                className="h-4 w-4 border-border accent-foreground"
              />
              Custom for this team
            </label>
          </div>
          {overrideOn && draft.workingHoursOverride && (
            <WorkingHoursEditor
              value={draft.workingHoursOverride}
              onChange={(next) => update(next)}
            />
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// Mirror the per-MT serialiser: blank/all-empty schedules collapse to null so users don't
// accidentally lock themselves out of every bookable slot.
function serialiseOverride(s: Schedule | null): Schedule | null {
  if (!s) return null;
  const allEmpty = (Object.keys(s) as (keyof Schedule)[]).every((k) => s[k].length === 0);
  if (allEmpty) return null;
  return coerceSchedule(s);
}
