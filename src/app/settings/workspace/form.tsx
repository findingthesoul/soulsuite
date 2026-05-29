"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDirtyState } from "@/lib/use-dirty-state";
import { PageHeader, SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";

interface Initial {
  name: string;
  slug: string;
  primaryEmailDomain: string;
  sharedZoomRoomUrl: string | null;
  sharedTeamsRoomUrl: string | null;
  // MT counts per shared-room flavour, used to warn before clearing a URL that bookings depend on.
  sharedZoomMtCount: number;
  sharedTeamsMtCount: number;
}

// What the form actually tracks as dirty state. URL fields are strings (empty when null) so the
// dirty-tracking and Input bindings stay straightforward. Counts live outside the draft.
interface Draft {
  name: string;
  slug: string;
  primaryEmailDomain: string;
  sharedZoomRoomUrl: string;
  sharedTeamsRoomUrl: string;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function WorkspaceSettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, setDraft, dirty, reset, commit } = useDirtyState<Draft>({
    name: initial.name,
    slug: initial.slug,
    primaryEmailDomain: initial.primaryEmailDomain,
    sharedZoomRoomUrl: initial.sharedZoomRoomUrl ?? "",
    sharedTeamsRoomUrl: initial.sharedTeamsRoomUrl ?? "",
  });
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
    if (draft.sharedZoomRoomUrl.trim() && !draft.sharedZoomRoomUrl.trim().startsWith("https://")) {
      return setError("Shared Zoom room URL must start with https://");
    }
    if (draft.sharedZoomRoomUrl.length > 300) {
      return setError("Shared Zoom room URL is too long (max 300 characters).");
    }
    if (draft.sharedTeamsRoomUrl.trim() && !draft.sharedTeamsRoomUrl.trim().startsWith("https://")) {
      return setError("Shared Teams room URL must start with https://");
    }
    if (draft.sharedTeamsRoomUrl.length > 300) {
      return setError("Shared Teams room URL is too long (max 300 characters).");
    }
    // Warn-on-clear per platform: clearing while MTs reference it doesn't auto-rewire — new
    // bookings fail loudly at finalize. Mirrors the personal-room confirm on the profile page.
    const clearingZoom =
      (initial.sharedZoomRoomUrl ?? "").length > 0 && draft.sharedZoomRoomUrl.trim().length === 0;
    if (clearingZoom && initial.sharedZoomMtCount > 0) {
      const ok = confirm(
        `${initial.sharedZoomMtCount} meeting type${initial.sharedZoomMtCount === 1 ? "" : "s"} use the workspace's shared Zoom room. Clearing this URL will break new bookings on ${initial.sharedZoomMtCount === 1 ? "that one" : "those"} until you set it again or switch them to a different provider. Continue?`,
      );
      if (!ok) return;
    }
    const clearingTeams =
      (initial.sharedTeamsRoomUrl ?? "").length > 0 && draft.sharedTeamsRoomUrl.trim().length === 0;
    if (clearingTeams && initial.sharedTeamsMtCount > 0) {
      const ok = confirm(
        `${initial.sharedTeamsMtCount} meeting type${initial.sharedTeamsMtCount === 1 ? "" : "s"} use the workspace's shared Teams room. Clearing this URL will break new bookings on ${initial.sharedTeamsMtCount === 1 ? "that one" : "those"} until you set it again or switch them to a different provider. Continue?`,
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const next: Draft = {
        name: draft.name.trim(),
        slug: draft.slug,
        primaryEmailDomain: draft.primaryEmailDomain.toLowerCase(),
        sharedZoomRoomUrl: draft.sharedZoomRoomUrl.trim(),
        sharedTeamsRoomUrl: draft.sharedTeamsRoomUrl.trim(),
      };
      const res = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: next.name,
          slug: next.slug,
          primaryEmailDomain: next.primaryEmailDomain,
          sharedZoomRoomUrl: next.sharedZoomRoomUrl || null,
          sharedTeamsRoomUrl: next.sharedTeamsRoomUrl || null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit(next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <DirtyNavGuard dirty={dirty} onSave={save} />
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

      <Card>
        <CardHeader>
          <CardTitle>Shared meeting rooms</CardTitle>
          <CardDescription>
            Workspace-level persistent meeting links anyone on your team can point a meeting
            type at. Useful when you publish one company room and rotate hosts behind it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sharedZoomRoomUrl">Shared Zoom room URL</Label>
            <Input
              id="sharedZoomRoomUrl"
              type="url"
              value={draft.sharedZoomRoomUrl}
              onChange={(e) => setDraft({ ...draft, sharedZoomRoomUrl: e.target.value })}
              placeholder="https://soul.zoom.us/j/0000000000"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              Meeting types set to{" "}
              <span className="text-foreground">Workspace Zoom room</span> hand this link to
              invitees regardless of which host is on the booking.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sharedTeamsRoomUrl">Shared Teams room URL</Label>
            <Input
              id="sharedTeamsRoomUrl"
              type="url"
              value={draft.sharedTeamsRoomUrl}
              onChange={(e) => setDraft({ ...draft, sharedTeamsRoomUrl: e.target.value })}
              placeholder="https://teams.microsoft.com/l/meetup-join/..."
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              Meeting types set to{" "}
              <span className="text-foreground">Workspace Teams room</span> hand this link to
              invitees regardless of which host is on the booking.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
