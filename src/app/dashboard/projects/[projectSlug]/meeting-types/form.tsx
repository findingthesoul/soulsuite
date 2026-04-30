"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  MAX_ADVANCE_DAYS,
  formatMinutes,
  formatBuffer,
  formatMaxAdvanceDays,
} from "@/lib/scheduling-rules";
import { type IntakeField, FIELD_TYPE_LABELS } from "@/lib/intake";
import { IntakeFieldsEditor } from "@/components/intake-fields-editor";

type ConferencingProvider = "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "NONE";

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
  routingMode: "SINGLE" | "ROUND_ROBIN";
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
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
  routingMode: "SINGLE" | "ROUND_ROBIN";
  assignedHostIds: string[];
  intakeFields: IntakeField[];
  isActive: boolean;
  conferencingProvider: ConferencingProvider;
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
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [editing, setEditing] = useState(!isEdit);

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
  };

  const [committed, setCommitted] = useState<DraftValues>(() =>
    initial
      ? {
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
        }
      : draftDefault,
  );

  const [draft, setDraft] = useState<DraftValues>(committed);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // SINGLE-mode active host's calendars — used for the conflict-calendar override (which is
  // disabled in ROUND_ROBIN since each host has their own calendars).
  const singleHostId = draft.routingMode === "SINGLE" ? draft.assignedHostIds[0] : undefined;
  const activeHostCalendars = members.find((m) => m.hostId === singleHostId)?.calendars ?? [];

  // SINGLE → swap the one assigned host. Drops conflict calendar IDs that don't belong.
  function setSingleAssignedHost(hostId: string) {
    const host = members.find((m) => m.hostId === hostId);
    const validIds = new Set((host?.calendars ?? []).map((c) => c.id));
    setDraft((prev) => ({
      ...prev,
      assignedHostIds: [hostId],
      conflictCalendarIds: prev.conflictCalendarIds.filter((id) => validIds.has(id)),
    }));
  }

  // ROUND_ROBIN → toggle a host on/off in the assigned set.
  function toggleAssignedHost(hostId: string, on: boolean) {
    setDraft((prev) => {
      const set = new Set(prev.assignedHostIds);
      if (on) set.add(hostId);
      else set.delete(hostId);
      return { ...prev, assignedHostIds: [...set] };
    });
  }

  // Switching routing modes resets selection so we don't end up with invalid combinations.
  function setRoutingMode(mode: "SINGLE" | "ROUND_ROBIN") {
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
      conflictCalendarIds: mode === "ROUND_ROBIN" ? [] : prev.conflictCalendarIds,
    }));
  }

  function handleNameChange(value: string) {
    update("name", value);
    if (!slugTouched) update("slug", autoSlug(value));
  }

  function startEdit() {
    setDraft(committed);
    setSlugTouched(true);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    if (!isEdit) {
      router.push(`/dashboard/projects/${projectSlug}`);
      return;
    }
    setDraft(committed);
    setSlugTouched(true);
    setError(null);
    setEditing(false);
  }

  function submit() {
    setError(null);
    if (draft.name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(draft.slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    if (![15, 30, 45, 60, 90, 120].includes(draft.durationMinutes)) {
      return setError("Duration must be 15, 30, 45, 60, 90, or 120 minutes.");
    }
    if (draft.routingMode === "SINGLE") {
      const id = draft.assignedHostIds[0];
      if (!id || !members.some((m) => m.hostId === id)) {
        return setError("Pick an assigned host from the project members.");
      }
    } else {
      if (draft.assignedHostIds.length < 2) {
        return setError("Round-robin needs at least two assigned hosts.");
      }
      const allValid = draft.assignedHostIds.every((id) => members.some((m) => m.hostId === id));
      if (!allValid) return setError("All assigned hosts must be project members.");
    }
    if (draft.conferencingProvider === "ZOOM") {
      const missing = draft.assignedHostIds
        .map((id) => members.find((m) => m.hostId === id))
        .filter((m): m is ProjectMember => Boolean(m && !m.hasZoom));
      if (missing.length > 0) {
        return setError(
          `These assigned hosts haven't connected Zoom: ${missing.map((m) => m.name).join(", ")}. They need to connect in Settings → Connections first.`,
        );
      }
    }

    startTransition(async () => {
      const url = isEdit
        ? `/api/projects/${projectId}/meeting-types/${initial!.id}`
        : `/api/projects/${projectId}/meeting-types`;
      const method = isEdit ? "PATCH" : "POST";
      const body = {
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
      };
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      if (isEdit) {
        setCommitted({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
        setEditing(false);
        router.refresh();
      } else {
        router.push(`/dashboard/projects/${projectSlug}`);
        router.refresh();
      }
    });
  }

  async function destroy() {
    if (!isEdit) return;
    if (!confirm("Delete this meeting type? Existing bookings stay; the public link will 404.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/meeting-types/${initial!.id}`, { method: "DELETE" });
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
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Details</CardTitle>
              <CardDescription>Name, slug, duration, and assigned host.</CardDescription>
            </div>
            {isEdit && !editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!editing ? (
            <DetailsReadOnly committed={committed} projectSlug={projectSlug} members={members} />
          ) : (
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
              isEdit={isEdit}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling rules</CardTitle>
          <CardDescription>Buffers, how soon people can book, and how far ahead.</CardDescription>
        </CardHeader>
        <CardContent>
          {!editing ? <SchedulingReadOnly committed={committed} /> : <SchedulingEditor draft={draft} update={update} />}
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
          {!editing ? (
            <ProjectConferencingReadOnly committed={committed} />
          ) : (
            <ProjectConferencingEditor draft={draft} update={update} members={members} />
          )}
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
          {!editing ? (
            <IntakeReadOnly fields={committed.intakeFields} />
          ) : (
            <IntakeFieldsEditor
              fields={draft.intakeFields}
              onChange={(next) => update("intakeFields", next)}
            />
          )}
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
            {!editing ? (
              <ConflictCalendarsReadOnly committed={committed} hostCalendars={activeHostCalendars} />
            ) : (
              <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={activeHostCalendars} />
            )}
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing && (
        <div className="flex items-center justify-between gap-2">
          {isEdit ? (
            <Button variant="destructive" onClick={destroy} disabled={pending}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Subviews
// ────────────────────────────────────────────────────────────

function DetailsReadOnly({
  committed,
  projectSlug,
  members,
}: {
  committed: DraftValues;
  projectSlug: string;
  members: ProjectMember[];
}) {
  const assignedNames = committed.assignedHostIds
    .map((id) => members.find((m) => m.hostId === id))
    .filter((m): m is ProjectMember => Boolean(m))
    .map((m) => m.name);
  const routingLabel =
    committed.routingMode === "ROUND_ROBIN"
      ? `Round-robin · ${assignedNames.length} hosts`
      : "Single host";
  return (
    <dl className="space-y-3 text-sm">
      <Row label="Name" value={committed.name} />
      <Row label="Booking link" value={`/${projectSlug}/${committed.slug}`} mono />
      <Row label="Duration" value={`${committed.durationMinutes} minutes`} />
      <Row label="Routing" value={routingLabel} />
      <Row label="Assigned" value={assignedNames.length > 0 ? assignedNames.join(", ") : "—"} />
      <Row label="Description" value={committed.description || "—"} />
      <Row label="Status" value={committed.isActive ? "Active" : "Inactive"} />
    </dl>
  );
}

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
  setRoutingMode: (mode: "SINGLE" | "ROUND_ROBIN") => void;
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
          onChange={(e) => setRoutingMode(e.target.value as "SINGLE" | "ROUND_ROBIN")}
        >
          <option value="SINGLE">Single host — one specific person</option>
          <option value="ROUND_ROBIN">Round-robin — least-recently-booked host gets the slot</option>
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
          <Label>Assigned hosts (pick at least 2)</Label>
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
            A slot is offered when any selected host is free; we assign the least-recently-booked one.
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

function SchedulingReadOnly({ committed }: { committed: DraftValues }) {
  return (
    <dl className="space-y-3 text-sm">
      <Row label="Buffer" value={formatBuffer(committed.bufferBeforeMinutes, committed.bufferAfterMinutes)} />
      <Row label="Min notice" value={formatMinutes(committed.minNoticeMinutes)} />
      <Row label="Max advance" value={formatMaxAdvanceDays(committed.maxAdvanceDays)} />
    </dl>
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
                {formatMaxAdvanceDays(d)}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

function IntakeReadOnly({ fields }: { fields: IntakeField[] }) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No intake questions — bookings only collect name + email.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {fields.map((f) => (
        <li key={f.key} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-foreground">
              {f.label || <span className="italic text-muted-foreground">Untitled</span>}
              {f.required && <span className="text-destructive ml-0.5">*</span>}
            </p>
            {f.conditionalOn && (
              <p className="text-xs text-muted-foreground">
                Shown when <span className="font-mono">{f.conditionalOn.fieldKey}</span> = &ldquo;{f.conditionalOn.equals}&rdquo;
              </p>
            )}
          </div>
          <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
            {FIELD_TYPE_LABELS[f.type]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConflictCalendarsReadOnly({
  committed,
  hostCalendars,
}: {
  committed: DraftValues;
  hostCalendars: ProjectMember["calendars"];
}) {
  if (committed.conflictCalendarIds.length === 0) {
    return <p className="text-sm text-muted-foreground">Using host default — every conflict-source calendar.</p>;
  }
  const ids = new Set(committed.conflictCalendarIds);
  const picked = hostCalendars.filter((c) => ids.has(c.id));
  if (picked.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No matching calendars. Edit to choose again.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {picked.map((c) => (
        <li key={c.id} className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="text-foreground">{c.summary}</span>
        </li>
      ))}
    </ul>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-subtle-foreground pt-0.5">{label}</dt>
      <dd className={mono ? "font-mono text-sm text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}

const PROJECT_PROVIDER_LABELS: Record<ConferencingProvider, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  TEAMS: "Microsoft Teams",
  NONE: "None (no link added)",
};

function ProjectConferencingReadOnly({ committed }: { committed: DraftValues }) {
  return <p className="text-sm text-foreground">{PROJECT_PROVIDER_LABELS[committed.conferencingProvider]}</p>;
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
