"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface BookingItem {
  id: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  inviteeName: string;
  meetingTypeName: string;
  status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED";
  href: string;
}

const HOUR_HEIGHT = 56; // px per hour
const START_HOUR = 7;   // 07:00
const END_HOUR = 21;    // 21:00 → 14 visible hours
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeekGrid({
  bookings,
  weekOfStart,
  timezone,
}: {
  bookings: BookingItem[];
  weekOfStart: string; // ISO Monday in UTC
  timezone: string;    // host's tz, used as initial render to keep SSR/client matched
}) {
  const [tz, setTz] = useState(timezone);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTz(detected);
    } catch {
      // keep host tz
    }
  }, []);

  // Compute the 7 day buckets for the week-of in the active tz. We use `en-CA` to format dates
  // as YYYY-MM-DD reliably across browsers/runtimes.
  const dayKeys = useMemo(() => {
    const start = new Date(weekOfStart);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const out: { key: string; date: Date }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 24 * 3600 * 1000);
      out.push({ key: fmt.format(d), date: d });
    }
    return out;
  }, [weekOfStart, tz]);

  // For each booking: figure out which day column it lives in (in `tz`), and where in the day
  // (minutes-from-day-start in `tz`).
  const positioned = useMemo(() => {
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const partsFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return bookings
      .map((b) => {
        const start = new Date(b.startsAt);
        const end = new Date(b.endsAt);
        const dayKey = dayFmt.format(start);
        const colIdx = dayKeys.findIndex((d) => d.key === dayKey);
        if (colIdx < 0) return null;

        const [sh, sm] = partsFmt.format(start).split(":").map(Number);
        const startMin = sh * 60 + sm;
        const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
        return { booking: b, colIdx, startMin, durationMin };
      })
      .filter((x): x is { booking: BookingItem; colIdx: number; startMin: number; durationMin: number } =>
        x !== null,
      );
  }, [bookings, dayKeys, tz]);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Day header */}
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}
      >
        <div />
        {dayKeys.map(({ date }, i) => {
          const isToday = isTodayInTz(date, tz);
          return (
            <div
              key={i}
              className={`px-3 py-3 text-center border-l border-border ${isToday ? "bg-surface-muted" : ""}`}
            >
              <p className="text-xs uppercase tracking-wide text-subtle-foreground">{DAY_LABELS[i]}</p>
              <p
                className={`text-sm font-medium ${isToday ? "text-foreground" : "text-muted-foreground"}`}
                suppressHydrationWarning
              >
                {formatDayNumber(date, tz)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="grid relative" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
        {/* Hour labels column */}
        <div>
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-xs text-subtle-foreground pr-2 text-right border-b border-border"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {dayKeys.map((_, dayIdx) => (
          <div
            key={dayIdx}
            className="relative border-l border-border"
            style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}
          >
            {/* Hour separators */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-b border-border"
                style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
              />
            ))}

            {/* Bookings */}
            {positioned
              .filter((p) => p.colIdx === dayIdx)
              .map((p) => {
                const top = ((p.startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                const height = (p.durationMin / 60) * HOUR_HEIGHT;
                if (top + height < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                const cancelled = p.booking.status === "CANCELLED";
                return (
                  <Link
                    key={p.booking.id}
                    href={p.booking.href}
                    className={`absolute left-1 right-1 rounded-md px-2 py-1 text-xs overflow-hidden transition-colors ${
                      cancelled
                        ? "bg-destructive/10 text-destructive line-through opacity-70 hover:opacity-100"
                        : "bg-foreground text-background hover:bg-foreground/90"
                    }`}
                    style={{ top: `${Math.max(0, top)}px`, height: `${Math.max(20, height - 2)}px` }}
                  >
                    <p className="font-medium truncate">{p.booking.inviteeName}</p>
                    <p className="opacity-80 truncate">{p.booking.meetingTypeName}</p>
                  </Link>
                );
              })}
          </div>
        ))}
      </div>

      {bookings.length === 0 && (
        <div className="p-6 text-center text-sm text-muted-foreground border-t border-border">
          No bookings this week.
        </div>
      )}
    </div>
  );
}

function isTodayInTz(date: Date, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(date) === fmt.format(new Date());
}

function formatDayNumber(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(date);
}
