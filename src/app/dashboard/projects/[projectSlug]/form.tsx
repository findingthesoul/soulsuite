"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Initial {
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function ProjectDetailsForm({
  canEdit,
  initial,
  projectId,
}: {
  canEdit: boolean;
  initial: Initial;
  projectId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [committed, setCommitted] = useState({
    name: initial.name,
    slug: initial.slug,
    description: initial.description ?? "",
    isActive: initial.isActive,
  });
  const [draft, setDraft] = useState(committed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(committed);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setDraft(committed);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    if (draft.name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(draft.slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          description: draft.description.trim() || null,
          isActive: draft.isActive,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      // If the slug changed, the URL of this page is stale — navigate to the new slug.
      if (draft.slug !== committed.slug) {
        router.push(`/dashboard/projects/${draft.slug}`);
        return;
      }
      setCommitted({
        name: draft.name.trim(),
        slug: draft.slug,
        description: draft.description.trim(),
        isActive: draft.isActive,
      });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Project details</CardTitle>
              <CardDescription>Identity and active state. Only project leads can edit.</CardDescription>
            </div>
            {canEdit && !editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!editing ? (
            <dl className="space-y-3 text-sm">
              <Row label="Name" value={committed.name} />
              <Row label="Slug" value={`/${committed.slug}`} mono />
              <Row label="Description" value={committed.description || "—"} />
              <Row label="Status" value={committed.isActive ? "Active" : "Archived"} />
            </dl>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() }))}
                />
                <p className="text-xs text-muted-foreground">
                  Changing this updates every booking link for this project.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={3}
                  className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-foreground"
                />
                Active — accept new bookings on this project&apos;s meeting types
              </label>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
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
