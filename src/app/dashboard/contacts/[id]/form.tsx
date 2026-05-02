"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "@/components/save-bar";
import { useDirtyState } from "@/lib/use-dirty-state";

interface Initial {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  location: string | null;
  timeZone: string | null;
}

interface Draft {
  phone: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  location: string;
  timeZone: string;
}

export function ContactDetailForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, dirty, update, discard, commit } = useDirtyState<Draft>({
    phone: initial.phone ?? "",
    company: initial.company ?? "",
    jobTitle: initial.jobTitle ?? "",
    linkedinUrl: initial.linkedinUrl ?? "",
    location: initial.location ?? "",
    timeZone: initial.timeZone ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (draft.linkedinUrl.trim() && !draft.linkedinUrl.startsWith("https://")) {
      return setError("LinkedIn URL must start with https://");
    }
    startTransition(async () => {
      const next: Draft = {
        phone: draft.phone.trim(),
        company: draft.company.trim(),
        jobTitle: draft.jobTitle.trim(),
        linkedinUrl: draft.linkedinUrl.trim(),
        location: draft.location.trim(),
        timeZone: draft.timeZone.trim(),
      };
      const res = await fetch(`/api/contacts/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: next.phone || null,
          company: next.company || null,
          jobTitle: next.jobTitle || null,
          linkedinUrl: next.linkedinUrl || null,
          location: next.location || null,
          timeZone: next.timeZone || null,
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
          <h1 className="text-2xl font-semibold tracking-tight">
            {initial.name ?? initial.email}
          </h1>
          <p className="text-sm text-muted-foreground">{initial.email}</p>
        </div>
        <SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Name and email are populated from booking history. Edit the rest freely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="name" label="Name">
            <Input id="name" value={initial.name ?? ""} disabled />
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
          <Field id="company" label="Company">
            <Input
              id="company"
              value={draft.company}
              onChange={(e) => update({ company: e.target.value })}
            />
          </Field>
          <Field id="jobTitle" label="Job title">
            <Input
              id="jobTitle"
              value={draft.jobTitle}
              onChange={(e) => update({ jobTitle: e.target.value })}
            />
          </Field>
          <Field id="linkedinUrl" label="LinkedIn URL">
            <Input
              id="linkedinUrl"
              value={draft.linkedinUrl}
              onChange={(e) => update({ linkedinUrl: e.target.value })}
              placeholder="https://www.linkedin.com/in/…"
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
          <Field id="timeZone" label="Time zone">
            <Input
              id="timeZone"
              value={draft.timeZone}
              onChange={(e) => update({ timeZone: e.target.value })}
              placeholder="Europe/Amsterdam"
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
