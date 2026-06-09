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

type Conferencing =
  | "GOOGLE_MEET"
  | "ZOOM"
  | "PERSONAL_ZOOM_ROOM"
  | "PERSONAL_TEAMS_ROOM"
  | "WORKSPACE_ZOOM_ROOM"
  | "WORKSPACE_TEAMS_ROOM"
  | "NONE";

interface SlotSummary {
  startsAt: string;
  endsAt: string;
  freeAttendeeIds: string[];
  busyAttendeeIds: string[];
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

export function TeamMeetingForm({
  callerName,
  attendees,
  workspaceHasZoomRoom,
  workspaceHasTeamsRoom,
  hostHasZoom,
  hostHasPersonalZoomRoom,
  hostHasPersonalTeamsRoom,
}: {
  callerName: string;
  attendees: Attendee[];
  workspaceHasZoomRoom: boolean;
  workspaceHasTeamsRoom: boolean;
  hostHasZoom: boolean;
  hostHasPersonalZoomRoom: boolean;
  hostHasPersonalTeamsRoom: boolean;
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
  // Multi-select picker: any number of candidate slots. 1 slot with everyone-free → direct book.
  // 1 slot with conflicts OR 2+ slots → send as poll so attendees can negotiate.
  const [pickedStartsAt, setPickedStartsAt] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | { kind: "BOOK"; subject: string; startsAt: string; meetUrl: string | null }
    | { kind: "POLL"; subject: string; pollId: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  // Lookup by id for chip rendering and missing-Google name resolution.
  const attendeesById = useMemo(() => new Map(attendees.map((a) => [a.id, a])), [attendees]);

  function toggleAttendee(id: string) {
    setPickedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPickedStartsAt([]);
  }

  function toggleSlot(startsAt: string) {
    setPickedStartsAt((prev) =>
      prev.includes(startsAt) ? prev.filter((x) => x !== startsAt) : [...prev, startsAt],
    );
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

  // Decision rule for the submit button:
  //   - 1 slot picked AND every attendee free at that slot → direct book (existing endpoint).
  //   - Anything else (multiple slots, OR one slot with conflicts) → send as poll. The slots
  //     become the poll's proposed_slots, attendees become invitees, the existing poll
  //     finalize flow takes over once everyone's voted.
  const pickedSlots = useMemo(
    () => pickedStartsAt.map((s) => slots.find((x) => x.startsAt === s)).filter(Boolean) as SlotSummary[],
    [pickedStartsAt, slots],
  );
  const mode: "BOOK" | "POLL" | "NONE" =
    pickedSlots.length === 0
      ? "NONE"
      : pickedSlots.length === 1 && pickedSlots[0].busyAttendeeIds.length === 0
        ? "BOOK"
        : "POLL";

  function submit() {
    setError(null);
    setSuccess(null);
    if (pickedIds.length === 0) return setError("Pick at least one teammate.");
    if (!subject.trim()) return setError("Add a subject for the meeting.");
    if (mode === "NONE") return setError("Pick at least one time.");
    if (conferencing === "NONE" && !location.trim() && mode === "BOOK") {
      // Location is optional, but flag the common mistake: "None" without a location field set
      // leaves the calendar event with no join hint at all. Soft confirm — not a hard block.
      if (!confirm("No conferencing and no location — invitees will see no join info. Continue?")) return;
    }
    if (mode === "BOOK") {
      const startsAt = pickedSlots[0].startsAt;
      startTransition(async () => {
        const res = await fetch("/api/team-meetings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attendeeIds: pickedIds,
            startsAt,
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
        setSuccess({ kind: "BOOK", subject: subject.trim(), startsAt, meetUrl: data.meetUrl });
        setPickedIds([]);
        setSubject("");
        setNote("");
        setLocation("");
        setPickedStartsAt([]);
        router.refresh();
      });
      return;
    }
    // POLL mode — send as a poll. Reuses /api/polls so the existing detail page + add-invitees
    // flow + finalize flow all just work. Poll invitees are the attendees' emails; tokens get
    // emailed to each so they can vote yes/maybe/no on every proposed slot.
    const attendeeEmails = pickedIds
      .map((id) => attendeesById.get(id)?.email)
      .filter((e): e is string => Boolean(e));
    const proposedSlots = pickedSlots.map((s, i) => ({
      id: `slot-${i}-${Math.random().toString(36).slice(2, 8)}`,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
    startTransition(async () => {
      const res = await fetch("/api/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: subject.trim(),
          durationMinutes,
          proposedSlots,
          inviteeEmails: attendeeEmails,
          scope: "PERSONAL",
          notifyMode: "FINAL_ONLY",
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't create the poll.");
        return;
      }
      const data = (await res.json()) as { id: string };
      setSuccess({ kind: "POLL", subject: subject.trim(), pollId: data.id });
      setPickedIds([]);
      setSubject("");
      setNote("");
      setLocation("");
      setPickedStartsAt([]);
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
                setPickedStartsAt([]);
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
            <option value="ZOOM" disabled={!hostHasZoom}>
              Zoom (fresh meeting per booking)
              {hostHasZoom ? "" : " — connect in Settings → Connections"}
            </option>
            <option value="PERSONAL_ZOOM_ROOM" disabled={!hostHasPersonalZoomRoom}>
              Personal Zoom room
              {hostHasPersonalZoomRoom ? "" : " — set on your Profile"}
            </option>
            <option value="PERSONAL_TEAMS_ROOM" disabled={!hostHasPersonalTeamsRoom}>
              Personal Teams room
              {hostHasPersonalTeamsRoom ? "" : " — set on your Profile"}
            </option>
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
              You have no free {durationMinutes}-min slot in the next 14 days. Try a shorter
              duration.
            </p>
          ) : (
            <>
              {pickedSlots.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-muted/40 px-3 py-2 mb-2">
                  <span className="text-xs text-muted-foreground mr-1">Selected:</span>
                  {pickedSlots
                    .slice()
                    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                    .map((s) => {
                      const d = new Date(s.startsAt);
                      const label = d.toLocaleString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <button
                          key={s.startsAt}
                          type="button"
                          onClick={() => toggleSlot(s.startsAt)}
                          className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-2 py-0.5 text-[11px] font-medium hover:opacity-90"
                          title="Click to remove"
                        >
                          {label}
                          <span aria-hidden>×</span>
                        </button>
                      );
                    })}
                </div>
              )}
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
                      onClick={() => setSelectedDate(dateKey)}
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
                  const active = pickedStartsAt.includes(s.startsAt);
                  const label = new Date(s.startsAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const freeCount = s.freeAttendeeIds.length;
                  const totalOthers = pickedIds.length;
                  const allFree = s.busyAttendeeIds.length === 0 && totalOthers > 0;
                  const conflictNames = s.busyAttendeeIds
                    .map((id) => attendeesById.get(id)?.name?.split(" ")[0])
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => toggleSlot(s.startsAt)}
                      title={
                        allFree
                          ? "Everyone is free"
                          : conflictNames
                            ? `Conflicts: ${conflictNames}`
                            : "No teammates picked"
                      }
                      className={`flex flex-col items-start gap-0.5 rounded-md px-3 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                        active
                          ? "bg-foreground text-background"
                          : allFree
                            ? "border border-foreground/40 bg-surface text-foreground hover:bg-surface-muted"
                            : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      <span>{label}</span>
                      {totalOthers > 0 && (
                        <span
                          className={`text-[10px] font-normal ${
                            active
                              ? "opacity-80"
                              : allFree
                                ? "text-foreground/70"
                                : "text-muted-foreground"
                          }`}
                        >
                          {allFree ? "all free" : `${freeCount}/${totalOthers} free`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            </>
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
        {success && success.kind === "BOOK" && (
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
        {success && success.kind === "POLL" && (
          <div className="rounded-md border border-border bg-surface-muted/40 p-3 text-sm space-y-1">
            <p className="text-foreground">
              <Check className="inline h-4 w-4 mr-1" />
              Poll sent — &ldquo;{success.subject}&rdquo;. Each teammate got a vote link by
              email.
            </p>
            <p className="text-xs text-muted-foreground">
              <a href={`/dashboard/polls/${success.pollId}`} className="underline">
                Open the poll
              </a>{" "}
              to watch responses and finalize once everyone&apos;s voted.
            </p>
          </div>
        )}

        <div className="space-y-1 pt-1">
          {mode !== "NONE" && (
            <p className="text-xs text-muted-foreground text-right">
              {mode === "BOOK"
                ? "Everyone's free at this time — books directly."
                : `Sends as a poll: ${pickedSlots.length} option${pickedSlots.length === 1 ? "" : "s"}, teammates pick what works.`}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={submit} disabled={pending || mode === "NONE"}>
              {pending
                ? mode === "POLL"
                  ? "Sending poll…"
                  : "Creating…"
                : mode === "POLL"
                  ? `Send as poll (${pickedSlots.length})`
                  : "Create meeting"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

