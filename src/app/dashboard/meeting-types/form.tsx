"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  isActive: boolean;
}

export interface HostCalendar {
  id: string;
  summary: string;
  role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET";
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
  isActive: boolean;
}

const DRAFT_DEFAULT: DraftValues = {
  name: "",
  slug: "",
  description: "",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
  conflictCalendarIds: [],
  isActive: true,
};

export function MeetingTypeForm({
  hostSlug,
  hostCalendars,
  initial,
}: {
  hostSlug: string;
  hostCalendars: HostCalendar[];
  initial?: Initial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [editing, setEditing] = useState(!isEdit);

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
          isActive: initial.isActive,
        }
      : DRAFT_DEFAULT,
  );

  const [draft, setDraft] = useState<DraftValues>(committed);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
      router.push("/dashboard/meeting-types");
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

    startTransition(async () => {
      const url = isEdit ? `/api/meeting-types/${initial!.id}` : `/api/meeting-types`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
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
          isActive: draft.isActive,
        }),
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
        router.push("/dashboard/meeting-types");
        router.refresh();
      }
    });
  }

  async function destroy() {
    if (!isEdit) return;
    if (!confirm("Delete this meeting type? Existing bookings stay; the public link will 404.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/meeting-types/${initial!.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.text()) || "Failed to delete");
        return;
      }
      router.push("/dashboard/meeting-types");
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
              <CardDescription>Name, slug, and duration are the essentials.</CardDescription>
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
            <DetailsReadOnly committed={committed} hostSlug={hostSlug} />
          ) : (
            <DetailsEditor
              draft={draft}
              update={update}
              hostSlug={hostSlug}
              isEdit={isEdit}
              onNameChange={handleNameChange}
              onSlugChange={(v) => {
                update("slug", v.toLowerCase());
                setSlugTouched(true);
              }}
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
          {!editing ? (
            <SchedulingReadOnly committed={committed} />
          ) : (
            <SchedulingEditor draft={draft} update={update} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conflict calendars</CardTitle>
          <CardDescription>
            Which of your calendars block this meeting type. Default uses every conflict-source you set in
            <Link href="/settings/calendars" className="underline ml-1">Settings → Calendars</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!editing ? (
            <ConflictCalendarsReadOnly committed={committed} hostCalendars={hostCalendars} />
          ) : (
            <ConflictCalendarsEditor draft={draft} update={update} hostCalendars={hostCalendars} />
          )}
        </CardContent>
      </Card>

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

function DetailsReadOnly({ committed, hostSlug }: { committed: DraftValues; hostSlug: string }) {
  return (
    <dl className="space-y-3 text-sm">
      <Row label="Name" value={committed.name} />
      <Row label="Booking link" value={`/${hostSlug}/${committed.slug}`} mono />
      <Row label="Duration" value={`${committed.durationMinutes} minutes`} />
      <Row label="Description" value={committed.description || "—"} />
      <Row label="Status" value={committed.isActive ? "Active" : "Inactive"} />
    </dl>
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

function DetailsEditor({
  draft,
  update,
  hostSlug,
  isEdit,
  onNameChange,
  onSlugChange,
}: {
  draft: DraftValues;
  update: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
  hostSlug: string;
  isEdit: boolean;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={draft.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Intro call"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{hostSlug}/</span>
          <Input
            id="slug"
            value={draft.slug}
            onChange={(e) => onSlugChange(e.target.value)}
            placeholder="intro-call"
          />
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
      <p className="text-xs text-muted-foreground">
        Buffers reserve quiet time around the meeting; e.g. 15 min after means the next slot can&apos;t start
        until 15 min after this one ends.
      </p>

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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-subtle-foreground pt-0.5">{label}</dt>
      <dd className={mono ? "font-mono text-sm text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}

function ConflictCalendarsReadOnly({
  committed,
  hostCalendars,
}: {
  committed: DraftValues;
  hostCalendars: HostCalendar[];
}) {
  if (committed.conflictCalendarIds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Using host default — every calendar marked as a conflict source.
      </p>
    );
  }
  const ids = new Set(committed.conflictCalendarIds);
  const picked = hostCalendars.filter((c) => ids.has(c.id));
  if (picked.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No matching calendars (selections may have been removed). Edit to choose again.
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
  hostCalendars: HostCalendar[];
}) {
  const overrideOn = draft.conflictCalendarIds.length > 0;

  function toggleOverride(on: boolean) {
    if (on) {
      // Pre-select the host's current default set so the override matches today's behaviour
      // before the user starts unticking calendars.
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
