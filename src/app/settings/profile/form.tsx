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
  const [editing, setEditing] = useState(false);
  const [committed, setCommitted] = useState<Draft>({
    name: initial.name,
    phone: initial.phone ?? "",
    location: initial.location ?? "",
    bio: initial.bio ?? "",
    photoUrl: initial.photoUrl ?? "",
  });
  const [draft, setDraft] = useState<Draft>(committed);
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
    if (draft.bio.length > 1000) return setError("Bio is limited to 1000 characters.");
    if (draft.photoUrl.trim() && !draft.photoUrl.startsWith("https://")) {
      return setError("Photo URL must start with https://");
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          phone: draft.phone.trim() || null,
          location: draft.location.trim() || null,
          bio: draft.bio.trim() || null,
          photoUrl: draft.photoUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      setCommitted({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        location: draft.location.trim(),
        bio: draft.bio.trim(),
        photoUrl: draft.photoUrl.trim(),
      });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Personal info</CardTitle>
            <CardDescription>Email is your Google sign-in and can&apos;t be changed here.</CardDescription>
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
            <Row label="Email" value={initial.email} mono />
            <Row label="Phone" value={committed.phone || "—"} />
            <Row label="Location" value={committed.location || "—"} />
            <Row label="Bio" value={committed.bio || "—"} multiline />
            <Row label="Photo" value={committed.photoUrl || "—"} mono />
          </dl>
        ) : (
          <>
            <Field id="name" label="Name">
              <Input id="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field id="email" label="Email (read-only)">
              <Input id="email" value={initial.email} disabled />
            </Field>
            <Field id="phone" label="Phone">
              <Input
                id="phone"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="+31 6 12 34 56 78"
              />
            </Field>
            <Field id="location" label="Location">
              <Input
                id="location"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Amsterdam, NL"
              />
            </Field>
            <Field id="bio" label="Bio">
              <textarea
                id="bio"
                value={draft.bio}
                onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
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
                onChange={(e) => setDraft({ ...draft, photoUrl: e.target.value })}
                placeholder="https://..."
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={cancel} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-subtle-foreground pt-0.5">{label}</dt>
      <dd className={`${mono ? "font-mono text-sm" : ""} ${multiline ? "whitespace-pre-line" : ""} text-foreground`}>
        {value}
      </dd>
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
