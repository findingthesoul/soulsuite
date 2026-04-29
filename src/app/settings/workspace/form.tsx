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
  primaryEmailDomain: string;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function WorkspaceSettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState(initial);
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
    if (!DOMAIN_RE.test(draft.primaryEmailDomain.toLowerCase())) {
      return setError("Primary email domain must look like soul.com (no @, no spaces).");
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug,
          primaryEmailDomain: draft.primaryEmailDomain.toLowerCase(),
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      setCommitted({ ...draft, name: draft.name.trim(), primaryEmailDomain: draft.primaryEmailDomain.toLowerCase() });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Identity</CardTitle>
              <CardDescription>Workspace name, URL slug, and the domain that gates membership.</CardDescription>
            </div>
            {!editing && (
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
              <Row label="Email domain" value={`@${committed.primaryEmailDomain}`} mono />
            </dl>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() }))}
                />
                <p className="text-xs text-muted-foreground">
                  Reserved for the workspace at /{draft.slug}/. Cannot collide with reserved routes or
                  any host slug.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domain">Primary email domain</Label>
                <Input
                  id="domain"
                  value={draft.primaryEmailDomain}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, primaryEmailDomain: e.target.value.toLowerCase().replace(/^@/, "") }))
                  }
                  placeholder="soul.com"
                />
                <p className="text-xs text-amber-700">
                  Changing this affects who can join the workspace. Existing members aren&apos;t removed,
                  but new sign-ins must match the new domain.
                </p>
              </div>
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
