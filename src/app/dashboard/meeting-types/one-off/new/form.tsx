"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type ConferencingProvider = "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "NONE";

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

interface SlotDraft {
  // Local datetime strings as typed in <input type="datetime-local">.
  start: string;
  end: string;
}

export function OneOffMeetingTypeForm({
  hostSlug,
  hostHasZoom,
}: {
  hostSlug: string;
  hostHasZoom: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [conferencingProvider, setConferencingProvider] = useState<ConferencingProvider>("GOOGLE_MEET");
  const [slots, setSlots] = useState<SlotDraft[]>([{ start: "", end: "" }]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(autoSlug(value));
  }

  function addSlot() {
    setSlots((prev) => [...prev, { start: "", end: "" }]);
  }
  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateSlot(idx: number, field: keyof SlotDraft, value: string) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    if (conferencingProvider === "ZOOM" && !hostHasZoom) {
      return setError("Connect Zoom in Settings → Connections before picking it.");
    }
    if (slots.length < 1) return setError("Add at least one slot.");

    const toSend: { startsAt: string; endsAt: string }[] = [];
    for (const s of slots) {
      if (!s.start || !s.end) return setError("Every slot needs a start and end.");
      const startMs = new Date(s.start).getTime();
      const endMs = new Date(s.end).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return setError("Invalid slot date/time.");
      if (endMs <= startMs) return setError("Each slot's end must be after its start.");
      toSend.push({
        startsAt: new Date(s.start).toISOString(),
        endsAt: new Date(s.end).toISOString(),
      });
    }

    startTransition(async () => {
      const res = await fetch("/api/meeting-types/one-off", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          description: description.trim() || null,
          conferencingProvider,
          slots: toSend,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
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
          <CardTitle>Details</CardTitle>
          <CardDescription>Name, slug, and description shown on the booking page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Q&A session"
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
                placeholder="qa-session"
              />
            </div>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferencing</CardTitle>
          <CardDescription>Where the meeting happens.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="conferencingProvider">Provider</Label>
          <Select
            id="conferencingProvider"
            value={conferencingProvider}
            onChange={(e) => setConferencingProvider(e.target.value as ConferencingProvider)}
          >
            <option value="GOOGLE_MEET">Google Meet</option>
            <option value="ZOOM" disabled={!hostHasZoom}>
              Zoom{hostHasZoom ? "" : " — connect in Settings → Connections first"}
            </option>
            <option value="TEAMS" disabled>
              Microsoft Teams — coming later
            </option>
            <option value="NONE">None (no conferencing link)</option>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slots</CardTitle>
          <CardDescription>
            Each slot can be claimed by exactly one invitee. Times here bypass your working hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {slots.map((s, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
              <div className="space-y-1.5">
                <Label htmlFor={`start-${idx}`}>Starts</Label>
                <Input
                  id={`start-${idx}`}
                  type="datetime-local"
                  value={s.start}
                  onChange={(e) => updateSlot(idx, "start", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`end-${idx}`}>Ends</Label>
                <Input
                  id={`end-${idx}`}
                  type="datetime-local"
                  value={s.end}
                  onChange={(e) => updateSlot(idx, "end", e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removeSlot(idx)}
                disabled={slots.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addSlot}>
            <Plus className="h-3.5 w-3.5" />
            Add slot
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/dashboard/meeting-types")} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
