"use client";

import { useEffect, useMemo, useState } from "react";
import { PrefetchLink } from "@/components/prefetch-link";

interface BookingItem {
  id: string;
  startsAt: string;
  endsAt: string;
  inviteeName: string;
  meetingTypeName: string;
  status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED" | "PENDING_APPROVAL";
  href: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  bookings,
  monthOf, // YYYY-MM-DD of the 1st of the displayed month, in UTC
  gridStart, // ISO of the Monday on/before the 1st
  timezone,
}: {
  bookings: BookingItem[];
  monthOf: string;
  gridStart: string;
  timezone: string;
}) {
  const [tz, setTz] = useState(timezone);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTz(detected);
    } catch {
      /* keep host tz */
    }
  }, []);

  // 6 rows × 7 days = 42 cells. Each cell holds the bookings whose local-tz date matches.
  const cells = useMemo(() => {
    const start = new Date(gridStart);
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const monthOfMonth = monthOf.slice(0, 7); // YYYY-MM

    const buckets: Record<string, BookingItem[]> = {};
    for (const b of bookings) {
      const key = dayFmt.format(new Date(b.startsAt));
      (buckets[key] ??= []).push(b);
    }
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }

    const out: { dateKey: string; date: Date; inMonth: boolean; isToday: boolean; bookings: BookingItem[] }[] = [];
    const todayKey = dayFmt.format(new Date());
    for (let i = 0; i < 42; i++) {
      const date = new Date(start.getTime() + i * 24 * 3600 * 1000);
      const key = dayFmt.format(date);
      out.push({
        dateKey: key,
        date,
        inMonth: key.startsWith(monthOfMonth),
        isToday: key === todayKey,
        bookings: buckets[key] ?? [],
      });
    }
    return out;
  }, [bookings, gridStart, monthOf, tz]);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-subtle-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* 6 × 7 grid */}
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((cell, idx) => (
          <div
            key={idx}
            className={`border-l border-t border-border first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${
              !cell.inMonth ? "bg-surface-muted/40" : ""
            }`}
            style={{ minHeight: "96px" }}
          >
            <div className="px-2 pt-1.5">
              <span
                className={`inline-flex items-center justify-center text-xs ${
                  cell.isToday
                    ? "h-6 w-6 rounded-full bg-foreground text-background font-medium"
                    : cell.inMonth
                      ? "text-foreground"
                      : "text-subtle-foreground"
                }`}
                suppressHydrationWarning
              >
                {dayNumber(cell.date, tz)}
              </span>
            </div>
            <div className="px-1.5 pb-1.5 space-y-0.5 mt-1">
              {cell.bookings.slice(0, 3).map((b) => (
                <PrefetchLink
                  key={b.id}
                  href={b.href}
                  className={`block truncate rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                    b.status === "CANCELLED"
                      ? "bg-destructive/10 text-destructive line-through opacity-70 hover:opacity-100"
                      : "bg-foreground text-background hover:bg-foreground/90"
                  }`}
                  suppressHydrationWarning
                  title={`${formatTime(b.startsAt, tz)} · ${b.inviteeName} — ${b.meetingTypeName}`}
                >
                  <span className="opacity-80">{formatTime(b.startsAt, tz)}</span>{" "}
                  <span>{b.inviteeName}</span>
                </PrefetchLink>
              ))}
              {cell.bookings.length > 3 && (
                <p className="px-1.5 text-[11px] text-muted-foreground">+{cell.bookings.length - 3} more</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function dayNumber(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(date);
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
