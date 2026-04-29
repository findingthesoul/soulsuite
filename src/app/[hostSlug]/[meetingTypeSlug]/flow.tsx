"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Globe, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";

interface Host {
  slug: string;
  name: string;
  timezone: string;
}
interface MeetingType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
}
interface SerializedSlot {
  startsAt: string;
  endsAt: string;
}

function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function BookingFlow({
  host,
  meetingType,
  initialSlots,
}: {
  host: Host;
  meetingType: MeetingType;
  initialSlots: SerializedSlot[];
}) {
  const router = useRouter();
  // Start with the host's tz so server-rendered HTML matches client first paint. Swap to the
  // browser's detected tz after mount.
  const [tz, setTz] = useState(host.timezone);
  useEffect(() => {
    const detected = detectTz();
    if (detected && detected !== host.timezone) setTz(detected);
  }, [host.timezone]);

  // Group slots by their local date in the invitee's tz, then derive what dates are bookable
  // and which calendar month to display first.
  const slotsByDate = useMemo(() => groupByLocalDate(initialSlots, tz), [initialSlots, tz]);
  const availableDates = useMemo(() => new Set(Object.keys(slotsByDate)), [slotsByDate]);
  const firstDate = useMemo(
    () => [...availableDates].sort()[0] ?? todayKey(tz),
    [availableDates, tz],
  );

  const [displayed, setDisplayed] = useState(() => parseMonth(firstDate));
  const [selectedDate, setSelectedDate] = useState<string | null>(firstDate in slotsByDate ? firstDate : null);
  const [stagedSlot, setStagedSlot] = useState<SerializedSlot | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");

  function selectDate(date: string) {
    setSelectedDate(date);
    setStagedSlot(null);
  }

  function confirmSlot(slot: SerializedSlot) {
    setStagedSlot(slot);
    setStep("details");
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-14">
        <div className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
          <div className="grid md:grid-cols-[280px_1fr]">
            <EventPanel host={host} meetingType={meetingType} tz={tz} />
            <div className="p-6 md:p-8 border-t md:border-t-0 md:border-l border-border min-h-[480px]">
              {step === "pick" ? (
                <PickPanel
                  tz={tz}
                  setTz={setTz}
                  displayed={displayed}
                  setDisplayed={setDisplayed}
                  availableDates={availableDates}
                  selectedDate={selectedDate}
                  setSelectedDate={selectDate}
                  slotsByDate={slotsByDate}
                  stagedSlot={stagedSlot}
                  setStagedSlot={setStagedSlot}
                  onConfirm={confirmSlot}
                />
              ) : (
                <DetailsPanel
                  slot={stagedSlot}
                  tz={tz}
                  meetingType={meetingType}
                  host={host}
                  onBack={() => setStep("pick")}
                  onBooked={(id) => router.push(`/${host.slug}/${meetingType.slug}/confirmed/${id}`)}
                  onSlotGone={(message) => {
                    setStep("pick");
                    setStagedSlot(null);
                    router.refresh();
                    if (message) alert(message);
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-subtle-foreground">
          Powered by Soul Suite
        </p>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// Left column — event metadata
// ────────────────────────────────────────────────────────────

function EventPanel({ host, meetingType, tz }: { host: Host; meetingType: MeetingType; tz: string }) {
  return (
    <aside className="p-6 md:p-8 bg-surface-muted/40 space-y-5">
      <Avatar name={host.name} size="lg" />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{host.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight leading-tight">{meetingType.name}</h1>
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          <span>{meetingType.durationMinutes} minutes</span>
        </li>
        <li className="flex items-center gap-2">
          <Video className="h-4 w-4 shrink-0" />
          <span>Google Meet — link in invite</span>
        </li>
        <li className="flex items-center gap-2">
          <Globe className="h-4 w-4 shrink-0" />
          <span>{tz}</span>
        </li>
      </ul>
      {meetingType.description && (
        <p className="pt-3 border-t border-border text-sm text-foreground whitespace-pre-line">
          {meetingType.description}
        </p>
      )}
    </aside>
  );
}

// ────────────────────────────────────────────────────────────
// Right column — calendar grid + time list
// ────────────────────────────────────────────────────────────

function PickPanel({
  tz,
  setTz,
  displayed,
  setDisplayed,
  availableDates,
  selectedDate,
  setSelectedDate,
  slotsByDate,
  stagedSlot,
  setStagedSlot,
  onConfirm,
}: {
  tz: string;
  setTz: (tz: string) => void;
  displayed: { year: number; month: number };
  setDisplayed: (d: { year: number; month: number }) => void;
  availableDates: Set<string>;
  selectedDate: string | null;
  setSelectedDate: (d: string) => void;
  slotsByDate: Record<string, SerializedSlot[]>;
  stagedSlot: SerializedSlot | null;
  setStagedSlot: (s: SerializedSlot | null) => void;
  onConfirm: (s: SerializedSlot) => void;
}) {
  const slots = selectedDate ? slotsByDate[selectedDate] ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Select a date &amp; time</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <CalendarGrid
          displayed={displayed}
          setDisplayed={setDisplayed}
          availableDates={availableDates}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />

        <div className="md:max-h-[360px] md:overflow-y-auto md:pr-1">
          {!selectedDate ? (
            <p className="text-sm text-muted-foreground pt-4">Pick a date to see times.</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-4">No times on this day.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground pb-1">
                {formatLongDate(selectedDate, tz)}
              </p>
              {slots.map((slot) => {
                const isStaged = stagedSlot?.startsAt === slot.startsAt;
                return (
                  <div key={slot.startsAt} className="flex gap-2">
                    <button
                      onClick={() => setStagedSlot(isStaged ? null : slot)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        isStaged
                          ? "border-foreground bg-foreground/5 text-foreground"
                          : "border-border bg-surface text-foreground hover:bg-surface-muted hover:border-border-strong",
                      )}
                    >
                      {formatTime(slot.startsAt, tz)}
                    </button>
                    {isStaged && (
                      <Button size="md" onClick={() => onConfirm(slot)} className="shrink-0">
                        Next
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-border flex flex-wrap items-center gap-3 text-sm">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Time zone:</span>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
        >
          {tzOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Standalone month-view calendar grid. Local logic — works with `tz` only via the date strings
// passed in `availableDates` (already grouped by tz).
function CalendarGrid({
  displayed,
  setDisplayed,
  availableDates,
  selectedDate,
  onSelect,
}: {
  displayed: { year: number; month: number };
  setDisplayed: (d: { year: number; month: number }) => void;
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(displayed.year, displayed.month - 1, 1),
  );

  // First day of the displayed month (0=Sunday). We render Monday-first so subtract.
  const firstDow = new Date(displayed.year, displayed.month - 1, 1).getDay();
  const offset = (firstDow + 6) % 7; // shift Sun=0..Sat=6 to Mon=0..Sun=6
  const daysInMonth = new Date(displayed.year, displayed.month, 0).getDate();

  const cells: ({ key: string; day: number; date: string } | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${displayed.year}-${String(displayed.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ key: date, day: d, date });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: number) {
    let m = displayed.month + delta;
    let y = displayed.year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setDisplayed({ year: y, month: m });
  }

  const today = todayKey("UTC"); // The visual "today" pip — not tz-aware on purpose; close enough.

  return (
    <div>
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm font-medium text-foreground">{monthLabel}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground py-2">
            {d}
          </div>
        ))}
        {cells.map((cell, i) =>
          !cell ? (
            <div key={`empty-${i}`} aria-hidden="true" />
          ) : (
            <DayCell
              key={cell.key}
              date={cell.date}
              day={cell.day}
              isToday={cell.date === today}
              isAvailable={availableDates.has(cell.date)}
              isSelected={selectedDate === cell.date}
              onSelect={onSelect}
            />
          ),
        )}
      </div>
    </div>
  );
}

function DayCell({
  date,
  day,
  isToday,
  isAvailable,
  isSelected,
  onSelect,
}: {
  date: string;
  day: number;
  isToday: boolean;
  isAvailable: boolean;
  isSelected: boolean;
  onSelect: (d: string) => void;
}) {
  const base =
    "relative aspect-square flex items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  if (!isAvailable) {
    return (
      <div className={cn(base, "text-subtle-foreground cursor-not-allowed")} aria-disabled="true">
        <span>{day}</span>
        {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-subtle-foreground" />}
      </div>
    );
  }
  if (isSelected) {
    return (
      <button type="button" onClick={() => onSelect(date)} className={cn(base, "bg-foreground text-background font-medium")}>
        {day}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      className={cn(base, "bg-surface-muted text-foreground font-medium hover:bg-surface-muted/70")}
    >
      {day}
      {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-foreground" />}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Step 2 — invitee details form
// ────────────────────────────────────────────────────────────

function DetailsPanel({
  slot,
  tz,
  meetingType,
  host,
  onBack,
  onBooked,
  onSlotGone,
}: {
  slot: SerializedSlot | null;
  tz: string;
  meetingType: MeetingType;
  host: Host;
  onBack: () => void;
  onBooked: (id: string) => void;
  onSlotGone: (message?: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!slot) return setError("Pick a time first.");
    if (name.trim().length < 1) return setError("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");

    startTransition(async () => {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingTypeId: meetingType.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          inviteeName: name.trim(),
          inviteeEmail: email.trim().toLowerCase(),
          inviteeTimezone: tz,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) {
          onSlotGone(text || "That slot was just booked. Pick another time.");
          return;
        }
        setError(text || "Failed to create booking.");
        return;
      }
      const data = (await res.json()) as { id: string };
      onBooked(data.id);
    });
  }

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="mt-3 text-base font-semibold tracking-tight">Confirm your details</h2>
        {slot && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatLongDate(slot.startsAt.slice(0, 10), tz)} · {formatTime(slot.startsAt, tz)} —{" "}
            {formatTime(slot.endsAt, tz)}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          A calendar invite from {host.name} will be sent to this email.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        {pending ? "Booking…" : "Schedule event"}
      </Button>
    </div>
  );
}

// ---------- helpers ----------

function groupByLocalDate(slots: SerializedSlot[], tz: string): Record<string, SerializedSlot[]> {
  const out: Record<string, SerializedSlot[]> = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const slot of slots) {
    const key = formatter.format(new Date(slot.startsAt)); // YYYY-MM-DD in tz
    (out[key] ??= []).push(slot);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}

// Locale is pinned to en-GB so server-rendered HTML matches the client's first paint regardless
// of the visitor's browser locale. Format is unambiguous ("Friday 1 May", "11:45"). Switching
// to the visitor's locale post-mount is possible but requires more state plumbing — defer.

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatLongDate(yyyymmdd: string, tz: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

function todayKey(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseMonth(yyyymmdd: string): { year: number; month: number } {
  const [y, m] = yyyymmdd.split("-").map(Number);
  return { year: y, month: m };
}

function tzOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") return intl.supportedValuesOf("timeZone");
  return ["Europe/Amsterdam", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"];
}
