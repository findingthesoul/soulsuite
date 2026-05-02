"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";
import {
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  MAX_ADVANCE_DAYS,
  formatMinutes,
} from "@/lib/scheduling-rules";
import { type IntakeField } from "@/lib/intake";
import { IntakeFieldsEditor } from "@/components/intake-fields-editor";
import {
  WorkingHoursEditor,
  coerceSchedule,
  defaultSchedule,
  type Schedule,
} from "@/components/working-hours-editor";

type ConferencingProvider = "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "NONE";
type RoutingMode = "SINGLE" | "ROUND_ROBIN" | "COLLECTIVE";

interface ProjectMember {
  hostId: string;
  name: string;
  email: string;
  isExternal: boolean;
  hasZoom: boolean;
  calendars: { id: string; summary: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" }[];
}

interface Initial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  conflictCalendarIds: string[];
  routingMode: RoutingMode;
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function autoSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

interface DraftValues {
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  conflictCalendarIds: string[];
  routingMode: RoutingMode;
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
  maxInvitees: number;
  workingHoursOverride: Schedule | null;
}

function initialToDraft(initial: Initial): DraftValues {
  return {
    name: initial.name,
    slug: initial.slug,
    description: initial.description ?? "",
    durationMinutes: initial.durationMinutes,
    bufferBeforeMinutes: initial.bufferBeforeMinutes,
    bufferAfterMinutes: initial.bufferAfterMinutes,
    minNoticeMinutes: initial.minNoticeMinutes,
    maxAdvanceDays: initial.maxAdvanceDays,
    conflictCalendarIds: initial.conflictCalendarIds,
    routingMode: initial.routingMode,
    assignedHostIds: initial.assignedHostIds,
    intakeFields: initial.intakeFields,
    isActive: initial.isActive,
    conferencingProvider: initial.conferencingProvider,
    maxInvitees: initial.maxInvitees,
    workingHoursOverride: initial.workingHoursOverride,
  };
}

export function ProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
  initial,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
  initial?: Initial;
}) {
  const isEdit = Boolean(initial);
  if (isEdit && initial) {
    return (
      <EditProjectMeetingTypeForm
        projectId={projectId}
        projectSlug={projectSlug}
        members={members}
        initial={initial}
      />
    );
  }
  return (
    <CreateProjectMeetingTypeForm
      projectId={projectId}
      projectSlug={projectSlug}
      members={members}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Edit (direct-edit pattern)
// ────────────────────────────────────────────────────────────

function EditProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
  initial,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
  initial: Initial;
}) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<DraftValues>(initialToDraft(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft({ ...draft, [key]: value });
  }

  const singleHostId = draft.routingMode === "SINGLE" ? draft.assignedHostIds[0] : undefined;
  const activeHostCalendars = members.find((m) => m.hostId === singleHostId)?.calendars ?? [];

  function setSingleAssignedHost(hostId: string) {
    const host = members.find((m) => m.hostId === hostId);
    const validIds = new Set((host?.calendars ?? []).map((c) => c.id));
    setDraft({
      ...draft,
      assignedHostIds: [hostId],
      conflictCalendarIds: draft.conflictCalendarIds.filter((id: string) => validIds.has(id)),
    });
  }

  function toggleAssignedHost(hostId: string, on: boolean) {
    const set = new Set(draft.assignedHostIds);
    if (on) set.add(hostId);
    else set.delete(hostId);
    setDraft({ ...draft, assignedHostIds: [...set] });
  }

  function setRoutingMode(mode: RoutingMode) {
    setDraft({
      ...draft,
      routingMode: mode,
      assignedHostIds:
        mode === "SINGLE"
          ? draft.assignedHostIds.slice(0, 1).length > 0
            ? [draft.assignedHostIds[0]]
            : members[0]?.hostId
              ? [members[0].hostId]
              : []
          : draft.assignedHostIds,
      conflictCalendarIds: mode === "SINGLE" ? draft.conflictCalendarIds : [],
    });
  }

  function discard() {
    setError(null);
    reset();
  }

  function save() {
    setError(null);
    const validation = validateDraft(draft, members);
    if (validation) return setError(validation);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);

    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          description: draft.description.trim() || null,
          durationMinutes: draft.durationMinutes,
          bufferBeforeMinutes: draft.bufferBeforeMinutes,
          bufferAfterMinutes: draft.bufferAfterMinutes,
          minNoticeMinutes: draft.minNoticeMinutes,
          maxAdvanceDays: draft.maxAdvanceDays,
          conflictCalendarIds: draft.conflictCalendarIds,
          routingMode: draft.routingMode,
          assignedHostIds: draft.assignedHostIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          maxInvitees: draft.maxInvitees,
          workingHoursOverride: overridePayload,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
      router.refresh();
    });
  }

  async function destroy() {
    if (!confirm("Delete this meeting type? Existing bookings stay; the public link will 404.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types/${initial.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.text()) || "Failed to delete");
        return;
      }
      router.push(`/dashboard/projects/${projectSlug}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit meeting type"
        description={`Booking link: /${projectSlug}/${draft.slug || initial.slug}`}
        actions={<SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, slug, duration, and assigned host.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailsEditor
            draft={draft}
            update={update}
            onNameChange={(v) => update("name", v)}
            onSlugChange={(v) => update("slug", v.toLowerCase())}
            setSingleAssignedHost={setSingleAssignedHost}
            toggleAssignedHost={toggleAssignedHost}
            setRoutingMode={setRoutingMode}
            members={members}
            projectSlug={projectSlug}
            isEdit
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling rules</CardTitle>
          <CardDescription>Buffers, how soon people can book, and how far ahead.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulingEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>
            Defaults to each assigned host&apos;s working hours. Override here when this meeting type
            only happens at specific times — applies to every assigned host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Group bookings</CardTitle>
          <CardDescription>
            How many invitees can claim the same time slot. 1 keeps it 1:1. Only available with single-host routing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {draft.routingMode !== "SINGLE" ? (
            <p className="text-sm text-muted-foreground">
              Group bookings are only available with single-host routing. Switch to Single to enable.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="maxInvitees">Max invitees per slot</Label>
              <Input
                id="maxInvitees"
                type="number"
                min={1}
                max={50}
                value={draft.maxInvitees}
                onChange={(e) =>
                  update("maxInvitees", Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                }
              />
              <p className="text-xs text-muted-foreground">
                When &gt;1 the same slot accepts multiple bookings on a single calendar event.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferencing</CardTitle>
          <CardDescription>
            Where the meeting happens. Zoom requires every assigned host to have connected it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectConferencingEditor draft={draft} update={update} members={members} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intake questions</CardTitle>
          <CardDescription>
            Optional questions shown after the slot is picked. Answers are stored on the booking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntakeFieldsEditor
            fields={draft.intakeFields}
            onChange={(next) => update("intakeFields", next)}
          />
        </CardContent>
      </Card>

      {draft.routingMode === "SINGLE" && (
        <Card>
          <CardHeader>
            <CardTitle>Conflict calendars</CardTitle>
            <CardDescription>
              Which of the assigned host&apos;s calendars block this meeting type. Default uses every
              conflict-source they configured.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={activeHostCalendars} />
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-start">
        <Button variant="destructive" onClick={destroy} disabled={pending}>
          Delete
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Create (legacy bottom-CTA pattern — kept by design)
// ────────────────────────────────────────────────────────────

function CreateProjectMeetingTypeForm({
  projectId,
  projectSlug,
  members,
}: {
  projectId: string;
  projectSlug: string;
  members: ProjectMember[];
}) {
  const router = useRouter();
  const draftDefault: DraftValues = {
    name: "",
    slug: "",
    description: "",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 60,
    maxAdvanceDays: 60,
    conflictCalendarIds: [],
    routingMode: "SINGLE",
    assignedHostIds: members[0]?.hostId ? [members[0].hostId] : [],
    intakeFields: [],
    isActive: true,
    conferencingProvider: "GOOGLE_MEET",
    maxInvitees: 1,
    workingHoursOverride: null,
  };

  const [draft, setDraft] = useState<DraftValues>(draftDefault);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const singleHostId = draft.routingMode === "SINGLE" ? draft.assignedHostIds[0] : undefined;
  const activeHostCalendars = members.find((m) => m.hostId === singleHostId)?.calendars ?? [];

  function setSingleAssignedHost(hostId: string) {
    const host = members.find((m) => m.hostId === hostId);
    const validIds = new Set((host?.calendars ?? []).map((c) => c.id));
    setDraft((prev) => ({
      ...prev,
      assignedHostIds: [hostId],
      conflictCalendarIds: prev.conflictCalendarIds.filter((id) => validIds.has(id)),
    }));
  }

  function toggleAssignedHost(hostId: string, on: boolean) {
    setDraft((prev) => {
      const set = new Set(prev.assignedHostIds);
      if (on) set.add(hostId);
      else set.delete(hostId);
      return { ...prev, assignedHostIds: [...set] };
    });
  }

  function setRoutingMode(mode: RoutingMode) {
    setDraft((prev) => ({
      ...prev,
      routingMode: mode,
      assignedHostIds:
        mode === "SINGLE"
          ? prev.assignedHostIds.slice(0, 1).length > 0
            ? [prev.assignedHostIds[0]]
            : members[0]?.hostId
              ? [members[0].hostId]
              : []
          : prev.assignedHostIds,
      conflictCalendarIds: mode === "SINGLE" ? prev.conflictCalendarIds : [],
    }));
  }

  function handleNameChange(value: string) {
    update("name", value);
    if (!slugTouched) update("slug", autoSlug(value));
  }

  function cancel() {
    router.push(`/dashboard/projects/${projectSlug}`);
  }

  function submit() {
    setError(null);
    const validation = validateDraft(draft, members);
    if (validation) return setError(validation);
    const overridePayload = serialiseOverride(draft.workingHoursOverride);

    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          description: draft.description.trim() || null,
          durationMinutes: draft.durationMinutes,
          bufferBeforeMinutes: draft.bufferBeforeMinutes,
          bufferAfterMinutes: draft.bufferAfterMinutes,
          minNoticeMinutes: draft.minNoticeMinutes,
          maxAdvanceDays: draft.maxAdvanceDays,
          conflictCalendarIds: draft.conflictCalendarIds,
          routingMode: draft.routingMode,
          assignedHostIds: draft.assignedHostIds,
          intakeFields: draft.intakeFields,
          isActive: draft.isActive,
          conferencingProvider: draft.conferencingProvider,
          maxInvitees: draft.maxInvitees,
          workingHoursOverride: overridePayload,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      router.push(`/dashboard/projects/${projectSlug}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, slug, duration, and assigned host.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailsEditor
            draft={draft}
            update={update}
            onNameChange={handleNameChange}
            onSlugChange={(v) => {
              update("slug", v.toLowerCase());
              setSlugTouched(true);
            }}
            setSingleAssignedHost={setSingleAssignedHost}
            toggleAssignedHost={toggleAssignedHost}
            setRoutingMode={setRoutingMode}
            members={members}
            projectSlug={projectSlug}
            isEdit={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling rules</CardTitle>
          <CardDescription>Buffers, how soon people can book, and how far ahead.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulingEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>
            Defaults to each assigned host&apos;s working hours. Override here when this meeting type
            only happens at specific times — applies to every assigned host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityEditor draft={draft} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Group bookings</CardTitle>
          <CardDescription>
            How many invitees can claim the same time slot. 1 keeps it 1:1. Only available with single-host routing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {draft.routingMode !== "SINGLE" ? (
            <p className="text-sm text-muted-foreground">
              Group bookings are only available with single-host routing.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="maxInvitees">Max invitees per slot</Label>
              <Input
                id="maxInvitees"
                type="number"
                min={1}
                max={50}
                value={draft.maxInvitees}
                onChange={(e) =>
                  update("maxInvitees", Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferencing</CardTitle>
          <CardDescription>
            Where the meeting happens. Zoom requires every assigned host to have connected it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectConferencingEditor draft={draft} update={update} members={members} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intake questions</CardTitle>
          <CardDescription>
            Optional questions shown after the slot is picked. Answers are stored on the booking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntakeFieldsEditor
            fields={draft.intakeFields}
            onChange={(next) => update("intakeFields", next)}
          />
        </CardContent>
      </Card>

      {draft.routingMode === "SINGLE" && (
        <Card>
          <CardHeader>
            <CardTitle>Conflict calendars</CardTitle>
            <CardDescription>
              Which of the assigned host&apos;s calendars block this meeting type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={activeHostCalendars} />
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Create"}
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

function validateDraft(draft: DraftValues, members: ProjectMember[]): string | null {
  if (draft.name.trim().length < 2) return "Name is required.";
  if (!SLUG_RE.test(draft.slug)) return "Slug must be 2–40 chars, lowercase letters/digits/hyphens.";
  if (![15, 30, 45, 60, 90, 120].includes(draft.durationMinutes)) {
    return "Duration must be 15, 30, 45, 60, 90, or 120 minutes.";
  }
  if (draft.routingMode === "SINGLE") {
    const id = draft.assignedHostIds[0];
    if (!id || !members.some((m) => m.hostId === id)) {
      return "Pick an assigned host from the project members.";
    }
  } else {
    const label = draft.routingMode === "COLLECTIVE" ? "Collective" : "Round-robin";
    if (draft.assignedHostIds.length < 2) {
      return `${label} needs at least two assigned hosts.`;
    }
    const allValid = draft.assignedHostIds.every((id) => members.some((m) => m.hostId === id));
    if (!allValid) return "All assigned hosts must be project members.";
  }
  if (!Number.isInteger(draft.maxInvitees) || draft.maxInvitees < 1 || draft.maxInvitees > 50) {
    return "Max invitees must be a whole number between 1 and 50.";
  }
  if (draft.maxInvitees > 1 && draft.routingMode !== "SINGLE") {
    return "Group meetings (max invitees > 1) only work with single-host routing.";
  }
  if (draft.conferencingProvider === "ZOOM") {
    const missing = draft.assignedHostIds
      .map((id) => members.find((m) => m.hostId === id))
      .filter((m): m is ProjectMember => Boolean(m && !m.hasZoom));
    if (missing.length > 0) {
      return `These assigned hosts haven't connected Zoom: ${missing
        .map((m) => m.name)
        .join(", ")}. They need to connect in Settings → Connections first.`;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Shared editors
// ────────────────────────────────────────────────────────────

function DetailsEditor({
  draft,
  update,
  onNameChange,
  onSlugChange,
  setSingleAssignedHost,
  toggleAssignedHost,
  setRoutingMode,
  members,
  projectSlug,
  isEdit,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  setSingleAssignedHost: (hostId: string) => void;
  toggleAssignedHost: (hostId: string, on: boolean) => void;
  setRoutingMode: (mode: RoutingMode) => void;
  members: ProjectMember[];
  projectSlug: string;
  isEdit: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={draft.name} onChange={(e) => onNameChange(e.target.value)} placeholder="Project kickoff" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{projectSlug}/</span>
          <Input id="slug" value={draft.slug} onChange={(e) => onSlugChange(e.target.value)} placeholder="kickoff" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="duration">Duration</Label>
        <Select
          id="duration"
          value={String(draft.durationMinutes)}
          onChange={(e) => update("durationMinutes", Number(e.target.value))}
        >
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
          <option value="90">90 minutes</option>
          <option value="120">120 minutes</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="routingMode">Routing</Label>
        <Select
          id="routingMode"
          value={draft.routingMode}
          onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}
        >
          <option value="SINGLE">Single host — one specific person</option>
          <option value="ROUND_ROBIN">Round-robin — least-recently-booked host gets the slot</option>
          <option value="COLLECTIVE">Collective — all assigned hosts attend together</option>
        </Select>
      </div>

      {draft.routingMode === "SINGLE" ? (
        <div className="space-y-1.5">
          <Label htmlFor="assignedHost">Assigned host</Label>
          <Select
            id="assignedHost"
            value={draft.assignedHostIds[0] ?? ""}
            onChange={(e) => setSingleAssignedHost(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.hostId} value={m.hostId}>
                {m.name} — {m.email}
                {m.isExternal ? " (external)" : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>
            Assigned hosts (pick at least 2)
            {draft.routingMode === "COLLECTIVE" && (
              <span className="ml-1 text-xs text-muted-foreground">— all attend every meeting</span>
            )}
          </Label>
          <ul className="rounded-md border border-border divide-y divide-border">
            {members.map((m) => {
              const checked = draft.assignedHostIds.includes(m.hostId);
              return (
                <li key={m.hostId} className="flex items-center justify-between gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleAssignedHost(m.hostId, e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                    />
                    <span className="truncate text-foreground">
                      {m.name} <span className="text-muted-foreground">— {m.email}</span>
                      {m.isExternal && (
                        <span className="ml-1 text-xs uppercase tracking-wide text-subtle-foreground">
                          external
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {draft.routingMode === "COLLECTIVE"
              ? "A slot is offered only when every selected host is free; the booking adds all of them as attendees."
              : "A slot is offered when any selected host is free; we assign the least-recently-booked one."}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="Shown on the booking page."
          className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>
      {isEdit && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
            className="h-4 w-4 rounded border-border accent-foreground"
          />
          Active — accept new bookings
        </label>
      )}
    </>
  );
}

function SchedulingEditor({
  draft,
  update,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bufferBefore">Buffer before</Label>
          <Select
            id="bufferBefore"
            value={String(draft.bufferBeforeMinutes)}
            onChange={(e) => update("bufferBeforeMinutes", Number(e.target.value))}
          >
            {BUFFER_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {m === 0 ? "None" : `${m} min`}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bufferAfter">Buffer after</Label>
          <Select
            id="bufferAfter"
            value={String(draft.bufferAfterMinutes)}
            onChange={(e) => update("bufferAfterMinutes", Number(e.target.value))}
          >
            {BUFFER_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {m === 0 ? "None" : `${m} min`}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="minNotice">Minimum notice</Label>
          <Select
            id="minNotice"
            value={String(draft.minNoticeMinutes)}
            onChange={(e) => update("minNoticeMinutes", Number(e.target.value))}
          >
            {MIN_NOTICE_MINUTES.map((m) => (
              <option key={m} value={String(m)}>
                {formatMinutes(m)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxAdvance">Bookable up to</Label>
          <Select
            id="maxAdvance"
            value={String(draft.maxAdvanceDays)}
            onChange={(e) => update("maxAdvanceDays", Number(e.target.value))}
          >
            {MAX_ADVANCE_DAYS.map((d) => (
              <option key={d} value={String(d)}>
                {d} days
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

function AvailabilityEditor({
  draft,
  update,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
}) {
  const overrideOn = draft.workingHoursOverride !== null;
  function toggleOverride(on: boolean) {
    update("workingHoursOverride", on ? defaultSchedule() : null);
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="projectAvailabilityMode"
            checked={!overrideOn}
            onChange={() => toggleOverride(false)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Use each host&apos;s default working hours
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="projectAvailabilityMode"
            checked={overrideOn}
            onChange={() => toggleOverride(true)}
            className="h-4 w-4 border-border accent-foreground"
          />
          Custom for this meeting type (applied in each host&apos;s timezone)
        </label>
      </div>
      {overrideOn && draft.workingHoursOverride && (
        <WorkingHoursEditor
          value={draft.workingHoursOverride}
          onChange={(next) => update("workingHoursOverride", next)}
        />
      )}
    </div>
  );
}

function ConflictCalendarsEditor({
  draft,
  update,
  hostCalendars,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostCalendars: ProjectMember["calendars"];
}) {
  const overrideOn = draft.conflictCalendarIds.length > 0;
  function toggleOverride(on: boolean) {
    if (on) {
      const defaults = hostCalendars
        .filter((c) => c.role === "CONFLICT_CHECK" || c.role === "WRITE_TARGET")
        .map((c) => c.id);
      update("conflictCalendarIds", defaults);
    } else {
      update("conflictCalendarIds", []);
    }
  }
  function toggleCalendar(id: string, checked: boolean) {
    const set = new Set(draft.conflictCalendarIds);
    if (checked) set.add(id);
    else set.delete(id);
    update("conflictCalendarIds", Array.from(set));
  }

  if (hostCalendars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The assigned host hasn&apos;t finished onboarding their calendars yet — defaults will apply once they do.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!overrideOn}
          onChange={(e) => toggleOverride(!e.target.checked)}
          className="h-4 w-4 rounded border-border accent-foreground"
        />
        Use host default (every conflict-source calendar)
      </label>
      {overrideOn && (
        <ul className="rounded-md border border-border divide-y divide-border">
          {hostCalendars.map((c) => {
            const checked = draft.conflictCalendarIds.includes(c.id);
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3">
                <label className="flex items-center gap-2 text-sm flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleCalendar(c.id, e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                  />
                  <span className="truncate text-foreground">{c.summary}</span>
                </label>
                <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
                  {c.role === "WRITE_TARGET" ? "Write" : c.role === "CONFLICT_CHECK" ? "Conflict" : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProjectConferencingEditor({
  draft,
  update,
  members,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  members: ProjectMember[];
}) {
  const assigned = draft.assignedHostIds.map((id) => members.find((m) => m.hostId === id)).filter(Boolean) as ProjectMember[];
  const missingZoom = draft.conferencingProvider === "ZOOM" ? assigned.filter((m) => !m.hasZoom) : [];
  const anyAssignedHasZoom = assigned.some((m) => m.hasZoom);

  return (
    <div className="space-y-2">
      <Label htmlFor="projectConferencingProvider">Provider</Label>
      <Select
        id="projectConferencingProvider"
        value={draft.conferencingProvider}
        onChange={(e) => update("conferencingProvider", e.target.value as ConferencingProvider)}
      >
        <option value="GOOGLE_MEET">Google Meet</option>
        <option value="ZOOM" disabled={!anyAssignedHasZoom}>
          Zoom{anyAssignedHasZoom ? "" : " — at least one assigned host must connect Zoom first"}
        </option>
        <option value="TEAMS" disabled>
          Microsoft Teams — coming later
        </option>
        <option value="NONE">None (no conferencing link)</option>
      </Select>
      {missingZoom.length > 0 && (
        <p className="text-xs text-destructive">
          {missingZoom.map((m) => m.name).join(", ")} {missingZoom.length === 1 ? "hasn't" : "haven't"} connected Zoom yet.
        </p>
      )}
    </div>
  );
}

function serialiseOverride(s: Schedule | null): Schedule | null {
  if (!s) return null;
  const allEmpty = (Object.keys(s) as (keyof Schedule)[]).every((k) => s[k].length === 0);
  if (allEmpty) return null;
  return coerceSchedule(s);
}
