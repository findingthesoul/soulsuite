// Pure availability engine. Given working hours, busy intervals, and a meeting type,
// return the set of bookable slots in a date range.
//
// Pure means: no DB, no Google API, no `new Date()` unless `now` is omitted. This is what makes
// it testable. Callers wire in real data (see src/lib/availability/index.ts).
//
// Brief §6 calls this "the hard part". Bug-prone areas:
//   - DST transitions on the host's local date
//   - Buffers (apply to the slot being booked, not to existing events — see brief §6 buffer subtlety)
//   - Slot grid alignment when working hours don't start on a 15-min boundary

import { utcToZonedParts, zonedTimeToUtc } from "./timezone";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface WorkingHours {
  // Missing or empty array = unavailable that day. "HH:MM" wall-clock in the host's timezone.
  [day: string]: { start: string; end: string }[];
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface AvailabilityInput {
  host: {
    timezone: string;
    workingHours: WorkingHours;
  };
  meetingType: {
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minNoticeMinutes: number;
    maxAdvanceDays: number;
  };
  range: { from: Date; to: Date }; // UTC
  busy: BusyInterval[];
  /** Defaults to `new Date()`. Inject in tests for determinism. */
  now?: Date;
  /** Slot grid in minutes — defaults to 15 (brief §6). */
  slotIncrementMinutes?: number;
}

export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
}

export function computeAvailableSlots(input: AvailabilityInput): AvailableSlot[] {
  const now = input.now ?? new Date();
  const slotInc = input.slotIncrementMinutes ?? 15;
  const dur = input.meetingType.durationMinutes;
  const bufB = input.meetingType.bufferBeforeMinutes;
  const bufA = input.meetingType.bufferAfterMinutes;
  const earliest = new Date(now.getTime() + input.meetingType.minNoticeMinutes * 60000);
  const latest = new Date(now.getTime() + input.meetingType.maxAdvanceDays * 24 * 3600 * 1000);
  const busy = mergeBusy(input.busy);

  const slots: AvailableSlot[] = [];

  for (const date of iterateLocalDates(input.range.from, input.range.to, input.host.timezone)) {
    const weekday = utcToZonedParts(
      zonedTimeToUtc(date.year, date.month, date.day, 12, 0, input.host.timezone).getTime(),
      input.host.timezone,
    ).weekday;
    const dayKey = DAY_KEYS[weekday];
    const ranges = input.host.workingHours[dayKey] ?? [];

    for (const range of ranges) {
      const [sH, sM] = range.start.split(":").map(Number);
      const [eH, eM] = range.end.split(":").map(Number);
      const rangeStart = zonedTimeToUtc(date.year, date.month, date.day, sH, sM, input.host.timezone);
      const rangeEnd = zonedTimeToUtc(date.year, date.month, date.day, eH, eM, input.host.timezone);
      if (rangeEnd.getTime() <= rangeStart.getTime()) continue;

      let slotStart = alignUp(rangeStart, slotInc);
      while (true) {
        const slotEnd = new Date(slotStart.getTime() + dur * 60000);
        if (slotEnd.getTime() > rangeEnd.getTime()) break;
        // Hard cap by the caller's requested range — we may be iterating a date whose midnight
        // precedes range.to (because Europe/Amsterdam local midnight ≠ UTC midnight).
        if (slotEnd.getTime() > input.range.to.getTime()) break;
        if (slotStart.getTime() < input.range.from.getTime()) {
          slotStart = new Date(slotStart.getTime() + slotInc * 60000);
          continue;
        }
        if (slotStart.getTime() > latest.getTime()) break;

        const withinNotice = slotStart.getTime() >= earliest.getTime();

        // Brief §6 buffer subtlety: buffers extend the *requested slot's* footprint when checking
        // for conflicts with existing events. A meeting from 10:00–11:00 with a 15-min after-buffer
        // means the next bookable slot can't start before 11:15.
        const checkStart = new Date(slotStart.getTime() - bufB * 60000);
        const checkEnd = new Date(slotEnd.getTime() + bufA * 60000);

        if (withinNotice && !intersectsAny(checkStart, checkEnd, busy)) {
          slots.push({ startsAt: slotStart, endsAt: slotEnd });
        }
        slotStart = new Date(slotStart.getTime() + slotInc * 60000);
      }
    }
  }

  return slots;
}

function alignUp(d: Date, incrementMinutes: number): Date {
  const ms = incrementMinutes * 60000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function mergeBusy(busy: BusyInterval[]): BusyInterval[] {
  if (busy.length === 0) return [];
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: BusyInterval[] = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start.getTime() <= last.end.getTime()) {
      if (next.end.getTime() > last.end.getTime()) last.end = next.end;
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

function intersectsAny(start: Date, end: Date, busy: BusyInterval[]): boolean {
  for (const b of busy) {
    if (b.start.getTime() < end.getTime() && b.end.getTime() > start.getTime()) return true;
  }
  return false;
}

/** Yields each calendar date in `tz` whose midnight falls within [from, to). */
function* iterateLocalDates(
  from: Date,
  to: Date,
  tz: string,
): Generator<{ year: number; month: number; day: number }> {
  const start = utcToZonedParts(from.getTime(), tz);
  let y = start.year;
  let m = start.month;
  let d = start.day;
  // Hard cap on iterations to prevent runaway loops on bad input.
  for (let i = 0; i < 366; i++) {
    const midnight = zonedTimeToUtc(y, m, d, 0, 0, tz);
    if (midnight.getTime() >= to.getTime()) return;
    // Don't yield dates whose entire wall-clock day is before `from` — but in practice we yield
    // any date whose midnight precedes `to`, and slots before `from` get filtered by the slot
    // generator (which respects working-hour ranges, not the input range start).
    yield { year: y, month: m, day: d };
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
}
