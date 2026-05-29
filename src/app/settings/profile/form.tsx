"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";
import { useDirtyState } from "@/lib/use-dirty-state";

interface Initial {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  bio: string | null;
  photoUrl: string | null;
  personalZoomRoomUrl: string | null;
  personalTeamsRoomUrl: string | null;
  // Number of meeting types currently using each personal-room flavour, so we can warn the host
  // before they clear a stored URL (which would break new bookings on those MTs at finalize time).
  personalZoomRoomMtCount: number;
  personalTeamsRoomMtCount: number;
  requireApprovalDefault: boolean;
}

interface Draft {
  name: string;
  phone: string;
  location: string;
  bio: string;
  photoUrl: string;
  personalZoomRoomUrl: string;
  personalTeamsRoomUrl: string;
  requireApprovalDefault: boolean;
}

export function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, dirty, update, discard, commit } = useDirtyState<Draft>({
    name: initial.name,
    phone: initial.phone ?? "",
    location: initial.location ?? "",
    bio: initial.bio ?? "",
    photoUrl: initial.photoUrl ?? "",
    personalZoomRoomUrl: initial.personalZoomRoomUrl ?? "",
    personalTeamsRoomUrl: initial.personalTeamsRoomUrl ?? "",
    requireApprovalDefault: initial.requireApprovalDefault,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (draft.name.trim().length < 2) return setError("Name is required.");
    if (draft.bio.length > 1000) return setError("Bio is limited to 1000 characters.");
    if (draft.photoUrl.trim() && !draft.photoUrl.startsWith("https://")) {
      return setError("Photo URL must start with https://");
    }
    if (draft.personalZoomRoomUrl.trim() && !draft.personalZoomRoomUrl.trim().startsWith("https://")) {
      return setError("Personal Zoom room URL must start with https://");
    }
    if (draft.personalZoomRoomUrl.length > 300) {
      return setError("Personal Zoom room URL is too long (max 300 characters).");
    }
    if (draft.personalTeamsRoomUrl.trim() && !draft.personalTeamsRoomUrl.trim().startsWith("https://")) {
      return setError("Personal Teams room URL must start with https://");
    }
    if (draft.personalTeamsRoomUrl.length > 300) {
      return setError("Personal Teams room URL is too long (max 300 characters).");
    }
    // Warn-on-clear per platform: clearing either URL while MTs reference it doesn't auto-rewire
    // them — new bookings fail loudly at finalize instead of silently swapping providers. Surface
    // the impact so the host can back out.
    const clearingZoom =
      (initial.personalZoomRoomUrl ?? "").length > 0 && draft.personalZoomRoomUrl.trim().length === 0;
    if (clearingZoom && initial.personalZoomRoomMtCount > 0) {
      const ok = confirm(
        `${initial.personalZoomRoomMtCount} of your meeting type${
          initial.personalZoomRoomMtCount === 1 ? "" : "s"
        } use your Zoom personal room. Clearing this URL will break new bookings on ${
          initial.personalZoomRoomMtCount === 1 ? "that one" : "those"
        } until you set it again or switch them to a different provider. Continue?`,
      );
      if (!ok) return;
    }
    const clearingTeams =
      (initial.personalTeamsRoomUrl ?? "").length > 0 && draft.personalTeamsRoomUrl.trim().length === 0;
    if (clearingTeams && initial.personalTeamsRoomMtCount > 0) {
      const ok = confirm(
        `${initial.personalTeamsRoomMtCount} of your meeting type${
          initial.personalTeamsRoomMtCount === 1 ? "" : "s"
        } use your Teams personal room. Clearing this URL will break new bookings on ${
          initial.personalTeamsRoomMtCount === 1 ? "that one" : "those"
        } until you set it again or switch them to a different provider. Continue?`,
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const next: Draft = {
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        location: draft.location.trim(),
        bio: draft.bio.trim(),
        photoUrl: draft.photoUrl.trim(),
        personalZoomRoomUrl: draft.personalZoomRoomUrl.trim(),
        personalTeamsRoomUrl: draft.personalTeamsRoomUrl.trim(),
        requireApprovalDefault: draft.requireApprovalDefault,
      };
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: next.name,
          phone: next.phone || null,
          location: next.location || null,
          bio: next.bio || null,
          photoUrl: next.photoUrl || null,
          personalZoomRoomUrl: next.personalZoomRoomUrl || null,
          personalTeamsRoomUrl: next.personalTeamsRoomUrl || null,
          requireApprovalDefault: next.requireApprovalDefault,
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
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">
            How you appear to teammates and invitees. Your sign-in email is fixed.
          </p>
        </div>
        <SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />
      </header>
      <DirtyNavGuard dirty={dirty} onSave={save} />

      <Card>
        <CardHeader>
          <CardTitle>Personal info</CardTitle>
          <CardDescription>Email is your Google sign-in and can&apos;t be changed here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="name" label="Name">
            <Input id="name" value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field id="email" label="Email">
            <Input id="email" value={initial.email} disabled />
          </Field>
          <Field id="phone" label="Phone">
            <Input
              id="phone"
              value={draft.phone}
              onChange={(e) => update({ phone: e.target.value })}
              placeholder="+31 6 12 34 56 78"
            />
          </Field>
          <Field id="location" label="Location">
            <Input
              id="location"
              value={draft.location}
              onChange={(e) => update({ location: e.target.value })}
              placeholder="Amsterdam, NL"
            />
          </Field>
          <Field id="bio" label="Bio">
            <textarea
              id="bio"
              value={draft.bio}
              onChange={(e) => update({ bio: e.target.value })}
              rows={4}
              maxLength={1000}
              placeholder="A short description for your booking pages."
              className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <p className="text-xs text-muted-foreground">{draft.bio.length}/1000</p>
          </Field>
          <Field id="photoUrl" label="Photo URL">
            <Input
              id="photoUrl"
              value={draft.photoUrl}
              onChange={(e) => update({ photoUrl: e.target.value })}
              placeholder="https://..."
            />
          </Field>
          <Field id="personalZoomRoomUrl" label="Personal Zoom room URL">
            <Input
              id="personalZoomRoomUrl"
              type="url"
              value={draft.personalZoomRoomUrl}
              onChange={(e) => update({ personalZoomRoomUrl: e.target.value })}
              placeholder="https://soul.zoom.us/my/yourname"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              Your Zoom Personal Meeting Room. Meeting types set to{" "}
              <span className="text-foreground">Personal Zoom room</span> hand this link to
              invitees instead of generating a fresh meeting per booking.
            </p>
          </Field>
          <Field id="personalTeamsRoomUrl" label="Personal Teams room URL">
            <Input
              id="personalTeamsRoomUrl"
              type="url"
              value={draft.personalTeamsRoomUrl}
              onChange={(e) => update({ personalTeamsRoomUrl: e.target.value })}
              placeholder="https://teams.microsoft.com/l/meetup-join/..."
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              Your Microsoft Teams permanent meeting link. Meeting types set to{" "}
              <span className="text-foreground">Personal Teams room</span> hand this link to
              invitees instead of generating a fresh meeting per booking.
            </p>
          </Field>
          <div className="space-y-1.5 pt-2 border-t border-border">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.requireApprovalDefault}
                onChange={(e) => update({ requireApprovalDefault: e.target.checked })}
                className="h-4 w-4 mt-0.5 rounded border-border accent-foreground"
              />
              <span>
                <span className="text-foreground">Require approval before confirming bookings</span>
                <span className="block text-xs text-muted-foreground">
                  Default for new meeting types. Existing meeting types keep their own setting.
                </span>
              </span>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
