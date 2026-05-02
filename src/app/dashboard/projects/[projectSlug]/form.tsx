"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDirtyState } from "@/lib/use-dirty-state";
import { SaveBar } from "@/components/save-bar";

interface Initial {
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
}

interface Draft {
  name: string;
  slug: string;
  description: string;
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
  const start: Draft = {
    name: initial.name,
    slug: initial.slug,
    description: initial.description ?? "",
    isActive: initial.isActive,
  };
  const { draft, setDraft, committed, dirty, reset, commit } = useDirtyState<Draft>(start);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      commit({
        name: draft.name.trim(),
        slug: draft.slug,
        description: draft.description.trim(),
        isActive: draft.isActive,
      });
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
            {canEdit && (
              <SaveBar
                dirty={dirty}
                pending={pending}
                onSave={save}
                onDiscard={() => {
                  reset();
                  setError(null);
                }}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={draft.name}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={draft.slug}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
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
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-foreground"
            />
            Active — accept new bookings on this project&apos;s meeting types
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
