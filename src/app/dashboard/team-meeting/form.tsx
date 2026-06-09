"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Attendee {
  id: string;
  name: string;
  email: string;
}

type Conferencing = "GOOGLE_MEET" | "WORKSPACE_ZOOM_ROOM" | "WORKSPACE_TEAMS_ROOM" | "NONE";

interface SlotSummary {
  startsAt: string;
  endsAt: string;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

export function TeamMeetingForm({
  callerName,
  attendees,
  workspaceHasZoomRoom,
  workspaceHasTeamsRoom,
}: {
  callerName: string;
  attendees: Attendee[];
  workspaceHasZoomRoom: boolean;
  workspaceHasTeamsRoom: boolean;
}) {
  const router = useRouter();
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [conferencing, setConferencing] = useState<Conferencing>("GOOGLE_MEET");
  const [location, setLocation] = useState("");
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [missingGoogle, setMissingGoogle] = useState<string[]>([]);
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ subject: string; startsAt: string; meetUrl: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  // Lookup by id for chip rendering and missing-Google name resolution.
  const attendeesById = useMemo(() => new Map(attendees.map((a) => [a.id, a])), [attendees]);

  function toggleAttendee(id: string) {
    setPickedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setSelectedStartsAt(null);
  }

  // Fetch mutual availability whenever the selection or duration changes. Range: next 14 days
  // (matches /dashboard/book). Aborted via signal when picker changes mid-flight.
  useEffect(() => {
    if (pickedIds.length === 0) {
      setSlots([]);
      setMissingGoogle([]);
      return;
    }
    const controller = new AbortController();
    setSlotsLoading(true);
    setError(null);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    fetch(
      `/api/team-meetings/slots?attendeeIds=${encodeURIComponent(pickedIds.join(","))}&durationMinutes=${durationMinutes}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || "Failed to load availability");
        return (await res.json()) as { slots: SlotSummary[]; missingGoogle?: string[] };
      })
      .then((data) => {
        setSlots(data.slots);
        setMissingGoogle(data.missingGoogle ?? []);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setSlots([]);
        setMissingGoogle([]);
      })
      .finally(() => setSlotsLoading(false));
    return () => controller.abort();
  }, [pickedIds, durationMinutes]);

  const slotsByDate = useMemo(() => {
    const out = new Map<string, SlotSummary[]>();
    for (const s of slots) {
      const d = new Date(s.startsAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = out.get(key) ?? [];
      arr.push(s);
      out.set(key, arr);
    }
    return out;
  }, [slots]);
  const availableDates = useMemo(() => Array.from(slotsByDate.keys()).sort(), [slotsByDate]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    if (availableDates.length === 0) {
      setSelectedDate(null);
      return;
    }
    if (!selectedDate || !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  function submit() {
    setError(null);
    setSuccess(null);
    if (pickedIds.length === 0) return setError("Pick at least one teammate.");
    if (!subject.trim()) return setError("Add a subject for the meeting.");
    if (!selectedStartsAt) return setError("Pick a time.");
    if (conferencing === "NONE" && !location.trim()) {
      // Location is optional, but flag the common mistake: "None" without a location field set
      // leaves the calendar event with no join hint at all. Confirm with the user via a soft
      // error rather than a hard block.
      if (!confirm("No conferencing and no location — invitees will see no join info. Continue?")) return;
    }
    startTransition(async () => {
      const res = await fetch("/api/team-meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attendeeIds: pickedIds,
          startsAt: selectedStartsAt,
          durationMinutes,
          subject: subject.trim(),
          note: note.trim() || null,
          conferencing,
          location: conferencing === "NONE" ? location.trim() || null : null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't create the meeting.");
        return;
      }
      const data = (await res.json()) as { eventId: string | null; meetUrl: string | null };
      setSuccess({ subject: subject.trim(), startsAt: selectedStartsAt, meetUrl: data.meetUrl });
      setPickedIds([]);
      setSubject("");
      setNote("");
      setLocation("");
      setSelectedStartsAt(null);
      router.refresh();
    });
  }

  if (attendees.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No teammates yet</CardTitle>
          <CardDescription>
            Invite people to your workspace under{" "}
            <a href="/settings/members" className="underline">Settings → Members</a> before
            scheduling an internal meeting.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Hi {callerName.split(" ")[0]} — you&apos;re always on the meeting. Just pick who else.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Teammates</Label>
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((a) => {
              const picked = pickedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAttendee(a.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    picked
                      ? "bg-foreground text-background"
                      : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                  }`}
                >
                  {picked && <Check className="h-3 w-3" />}
                  {a.name}
                </button>
              );
            })}
          </div>
          {missingGoogle.length > 0 && (
            <p className="text-xs text-destructive">
              {missingGoogle
                .map((id) => attendeesById.get(id)?.name ?? id)
                .filter(Boolean)
                .join(", ")}{" "}
              {missingGoogle.length === 1 ? "hasn't" : "haven't"} connected Google Calendar yet,
              so availability can&apos;t be checked.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Weekly sync"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duration">Duration</Label>
            <Select
              id="duration"
              value={String(durationMinutes)}
              onChange={(e) => {
                setDurationMinutes(Number(e.target.value));
                setSelectedStartsAt(null);
              }}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conferencing">Conferencing</Label>
          <Select
            id="conferencing"
            value={conferencing}
            onChange={(e) => setConferencing(e.target.value as Conferencing)}
          >
            <option value="GOOGLE_MEET">Google Meet (link auto-generated)</option>
            <option value="WORKSPACE_ZOOM_ROOM" disabled={!workspaceHasZoomRoom}>
              Workspace Zoom room
              {workspaceHasZoomRoom ? "" : " — set in Settings → Workspace"}
            </option>
            <option value="WORKSPACE_TEAMS_ROOM" disabled={!workspaceHasTeamsRoom}>
              Workspace Teams room
              {workspaceHasTeamsRoom ? "" : " — set in Settings → Workspace"}
            </option>
            <option value="NONE">None / in person</option>
          </Select>
          {conferencing === "NONE" && (
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional location (room name, address, etc.)"
              maxLength={500}
            />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>When everyone&apos;s free</Label>
            {slotsLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
          {pickedIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Pick a teammate to see times that work for both of you.
            </p>
          ) : slotsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
              <div className="space-y-1.5 opacity-50 pointer-events-none">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-md border border-border bg-surface-muted h-9 animate-pulse" />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 opacity-50 pointer-events-none">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-md border border-border bg-surface-muted h-9 w-20 animate-pulse" />
                ))}
              </div>
            </div>
          ) : availableDates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No mutual availability in the next 14 days at {durationMinutes} min. Try a shorter
              duration or fewer attendees.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                {availableDates.map((dateKey) => {
                  const d = new Date(`${dateKey}T12:00:00`);
                  const active = dateKey === selectedDate;
                  const count = slotsByDate.get(dateKey)?.length ?? 0;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => {
                        setSelectedDate(dateKey);
                        setSelectedStartsAt(null);
                      }}
                      className={`text-left rounded-md px-3 py-2 text-xs font-medium transition-colors flex items-center justify-between gap-3 ${
                        active
                          ? "bg-foreground text-background"
                          : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      <span>
                        {d.toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      <span className={active ? "opacity-70" : "text-muted-foreground"}>{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 content-start">
                {selectedDate && slotsByDate.get(selectedDate)?.map((s) => {
                  const active = selectedStartsAt === s.startsAt;
                  const label = new Date(s.startsAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => setSelectedStartsAt(s.startsAt)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                        active
                          ? "bg-foreground text-background"
                          : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note for the invite (optional)</Label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What this meeting is about, any prep, etc."
            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <div className="rounded-md border border-border bg-surface-muted/40 p-3 text-sm space-y-1">
            <p className="text-foreground">
              <Check className="inline h-4 w-4 mr-1" />
              Sent — &ldquo;{success.subject}&rdquo; on{" "}
              {new Date(success.startsAt).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              .
            </p>
            {success.meetUrl && (
              <p className="text-xs text-muted-foreground">
                Meet link:{" "}
                <a href={success.meetUrl} target="_blank" rel="noopener" className="underline">
                  {success.meetUrl}
                </a>
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={submit} disabled={pending || !selectedStartsAt}>
            {pending ? "Creating…" : "Create meeting"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

