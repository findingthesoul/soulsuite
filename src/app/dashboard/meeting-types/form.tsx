"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Initial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  isActive: boolean;
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

export function MeetingTypeForm({
  hostSlug,
  initial,
}: {
  hostSlug: string;
  initial?: Initial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  // For new meeting types, the form is always in "edit" mode. For existing ones we follow the
  // app-wide read-only-by-default → click Edit → Save/Cancel pattern (see CLAUDE.md).
  const [editing, setEditing] = useState(!isEdit);

  const [committed, setCommitted] = useState({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    description: initial?.description ?? "",
    durationMinutes: initial?.durationMinutes ?? 30,
    isActive: initial?.isActive ?? true,
  });

  const [name, setName] = useState(committed.name);
  const [slug, setSlug] = useState(committed.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [description, setDescription] = useState(committed.description);
  const [durationMinutes, setDurationMinutes] = useState(committed.durationMinutes);
  const [isActive, setIsActive] = useState(committed.isActive);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(autoSlug(value));
  }

  function startEdit() {
    setName(committed.name);
    setSlug(committed.slug);
    setSlugTouched(true);
    setDescription(committed.description);
    setDurationMinutes(committed.durationMinutes);
    setIsActive(committed.isActive);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    if (!isEdit) {
      router.push("/dashboard/meeting-types");
      return;
    }
    setName(committed.name);
    setSlug(committed.slug);
    setSlugTouched(true);
    setDescription(committed.description);
    setDurationMinutes(committed.durationMinutes);
    setIsActive(committed.isActive);
    setError(null);
    setEditing(false);
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    if (![15, 30, 45, 60, 90, 120].includes(durationMinutes)) {
      return setError("Duration must be 15, 30, 45, 60, 90, or 120 minutes.");
    }

    startTransition(async () => {
      const url = isEdit ? `/api/meeting-types/${initial!.id}` : `/api/meeting-types`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          description: description.trim() || null,
          durationMinutes,
          isActive,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      if (isEdit) {
        setCommitted({ name: name.trim(), slug, description: description.trim(), durationMinutes, isActive });
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
            <ReadOnlyView
              committed={committed}
              hostSlug={hostSlug}
              meetingTypeSlug={committed.slug}
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Intro call"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">/{hostSlug}/</span>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase());
                      setSlugTouched(true);
                    }}
                    placeholder="intro-call"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="duration">Duration</Label>
                <Select
                  id="duration"
                  value={String(durationMinutes)}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
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
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Shown on the booking page."
                  className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              </div>
              {isEdit && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                  Active — accept new bookings
                </label>
              )}
            </>
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

function ReadOnlyView({
  committed,
  hostSlug,
  meetingTypeSlug,
}: {
  committed: {
    name: string;
    slug: string;
    description: string;
    durationMinutes: number;
    isActive: boolean;
  };
  hostSlug: string;
  meetingTypeSlug: string;
}) {
  return (
    <dl className="space-y-3 text-sm">
      <Row label="Name" value={committed.name} />
      <Row label="Booking link" value={`/${hostSlug}/${meetingTypeSlug}`} mono />
      <Row label="Duration" value={`${committed.durationMinutes} minutes`} />
      <Row label="Description" value={committed.description || "—"} />
      <Row label="Status" value={committed.isActive ? "Active" : "Inactive"} />
    </dl>
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
