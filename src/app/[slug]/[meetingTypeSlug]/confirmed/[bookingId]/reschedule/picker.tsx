"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface Slot {
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

export function ReschedulePicker({
  bookingId,
  hostName,
  meetingTypeName,
  durationMinutes,
  currentStartsAt,
  currentEndsAt,
  slots,
  backUrl,
}: {
  bookingId: string;
  hostName: string;
  meetingTypeName: string;
  durationMinutes: number;
  currentStartsAt: string;
  currentEndsAt: string;
  slots: Slot[];
  backUrl: string;
}) {
  const router = useRouter();
  // SSR-stable: render in UTC + en-GB first, swap to detected tz post-mount.
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(detectTz()), []);

  const [picked, setPicked] = useState<Slot | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<string, Slot[]> = {};
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    for (const s of slots) {
      const key = fmt.format(new Date(s.startsAt));
      (out[key] ??= []).push(s);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return out;
  }, [slots, tz]);

  const dates = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  function submit() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startsAt: picked.startsAt, endsAt: picked.endsAt }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't reschedule.");
        return;
      }
      router.push(backUrl);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backUrl}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reschedule</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {meetingTypeName} with {hostName} · {durationMinutes} min
        </p>
        <p className="mt-3 text-sm text-foreground">
          <span className="text-muted-foreground">Current:</span>{" "}
          <span suppressHydrationWarning>{formatRange(currentStartsAt, currentEndsAt, tz)}</span>
        </p>
      </div>

      {dates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alternative times available right now.</p>
      ) : (
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {dates.map((date) => (
            <div key={date} className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-subtle-foreground" suppressHydrationWarning>
                {formatDateHeader(date, tz)}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {grouped[date].map((slot) => {
                  const isPicked =
                    picked?.startsAt === slot.startsAt && picked?.endsAt === slot.endsAt;
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => setPicked(slot)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        isPicked
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-surface text-foreground hover:border-foreground/40"
                      }`}
                      suppressHydrationWarning
                    >
                      {formatTime(slot.startsAt, tz)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Link href={backUrl} className={buttonVariants({ variant: "secondary" })}>
          Cancel
        </Link>
        <Button onClick={submit} disabled={!picked || pending}>
          {pending ? "Rescheduling…" : "Confirm new time"}
        </Button>
      </div>
    </div>
  );
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatDateHeader(yyyymmdd: string, tz: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

function formatRange(startsAt: string, endsAt: string, tz: string): string {
  const start = new Date(startsAt);
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    month: "long",
    day: "numeric",
  });
  return `${dateFmt.format(start)} · ${formatTime(startsAt, tz)}–${formatTime(endsAt, tz)}`;
}
