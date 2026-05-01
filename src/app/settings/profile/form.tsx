"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "@/components/save-bar";
import { useDirtyState } from "@/lib/use-dirty-state";

interface Initial {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  bio: string | null;
  photoUrl: string | null;
}

interface Draft {
  name: string;
  phone: string;
  location: string;
  bio: string;
  photoUrl: string;
}

export function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, dirty, update, discard, commit } = useDirtyState<Draft>({
    name: initial.name,
    phone: initial.phone ?? "",
    location: initial.location ?? "",
    bio: initial.bio ?? "",
    photoUrl: initial.photoUrl ?? "",
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
    startTransition(async () => {
      const next: Draft = {
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        location: draft.location.trim(),
        bio: draft.bio.trim(),
        photoUrl: draft.photoUrl.trim(),
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
