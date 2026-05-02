"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";

interface Initial {
  name: string;
  slug: string;
  primaryEmailDomain: string;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function WorkspaceSettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<Initial>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      commit({
        name: draft.name.trim(),
        slug: draft.slug,
        primaryEmailDomain: draft.primaryEmailDomain.toLowerCase(),
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace"
        description="Identity and the email domain that defines who can join."
        actions={
          <SaveBar
            dirty={dirty}
            pending={pending}
            onSave={save}
            onDiscard={() => {
              reset();
              setError(null);
            }}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Workspace name, URL slug, and the domain that gates membership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
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
                setDraft({ ...draft, primaryEmailDomain: e.target.value.toLowerCase().replace(/^@/, "") })
              }
              placeholder="soul.com"
            />
            <p className="text-xs text-amber-700">
              Changing this affects who can join the workspace. Existing members aren&apos;t removed,
              but new sign-ins must match the new domain.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
