import { describe, test, expect } from "vitest";
import { computeAvailableSlots, type WorkingHours } from "./engine";

const standardWeek: WorkingHours = {
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [],
  sun: [],
};

const baseHost = { timezone: "Europe/Amsterdam", workingHours: standardWeek };

const baseMt = {
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 60,
};

describe("computeAvailableSlots — basic shape", () => {
  test("generates 30-min slots on a 15-min grid within 09:00–17:00 weekday", () => {
    // 2026-05-04 is a Monday. CEST = UTC+2.
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    // Window 09:00–17:00 Amsterdam = 8h. Slot starts every 15 min, last start ≤ 16:30 (so end ≤ 17:00).
    // (16:30 - 09:00) / 15 + 1 = 31 starts.
    expect(slots).toHaveLength(31);
    // First slot starts at 09:00 Amsterdam = 07:00 UTC.
    expect(slots[0].startsAt.toISOString()).toBe("2026-05-04T07:00:00.000Z");
    // Last slot ends at 17:00 Amsterdam = 15:00 UTC.
    expect(slots[slots.length - 1].endsAt.toISOString()).toBe("2026-05-04T15:00:00.000Z");
  });

  test("returns no slots for a weekend day", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-05-09T00:00:00Z"), // Saturday
        to: new Date("2026-05-10T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    expect(slots).toHaveLength(0);
  });

  test("returns no slots if the day's working-hours array is empty", () => {
    const slots = computeAvailableSlots({
      host: { timezone: "Europe/Amsterdam", workingHours: { ...standardWeek, mon: [] } },
      meetingType: baseMt,
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    expect(slots).toHaveLength(0);
  });
});

describe("computeAvailableSlots — busy subtraction", () => {
  test("excludes any slot whose duration overlaps a busy interval", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      // 10:00–11:00 Amsterdam local = 08:00–09:00 UTC (CEST).
      busy: [{ start: new Date("2026-05-04T08:00:00Z"), end: new Date("2026-05-04T09:00:00Z") }],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    // Blocked starts (slot duration 30 min, busy 10:00–11:00):
    //   09:45 (ends 10:15), 10:00, 10:15, 10:30 (ends 11:00 — open interval, still touches),
    //   10:45 (ends 11:15) → 5 blocked. 31 - 5 = 26.
    expect(slots).toHaveLength(26);
    // Slot at 09:30–10:00 should still be present (ends exactly at busy start, no overlap).
    expect(slots.some((s) => s.startsAt.toISOString() === "2026-05-04T07:30:00.000Z")).toBe(true);
    // Slot at 11:00–11:30 should be present (starts exactly at busy end).
    expect(slots.some((s) => s.startsAt.toISOString() === "2026-05-04T09:00:00.000Z")).toBe(true);
  });

  test("merges overlapping busy intervals", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      busy: [
        { start: new Date("2026-05-04T08:00:00Z"), end: new Date("2026-05-04T09:00:00Z") },
        { start: new Date("2026-05-04T08:30:00Z"), end: new Date("2026-05-04T09:30:00Z") }, // overlaps
      ],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    // Merged busy is 10:00–11:30 Amsterdam = 08:00–09:30 UTC.
    // Blocked starts: 09:45, 10:00, 10:15, 10:30, 10:45, 11:00, 11:15 → 7 blocked.
    expect(slots).toHaveLength(31 - 7);
  });
});

describe("computeAvailableSlots — buffers", () => {
  test("after-buffer pushes the next bookable slot start later", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: { ...baseMt, bufferAfterMinutes: 15 },
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      // 10:00–11:00 Amsterdam = 08:00–09:00 UTC.
      busy: [{ start: new Date("2026-05-04T08:00:00Z"), end: new Date("2026-05-04T09:00:00Z") }],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    // No 15-min after-buffer would have allowed slot 11:00–11:30 (UTC 09:00). With after-buffer,
    // the slot's *checked footprint* extends 15 min past its end — but the buffer only matters
    // when the busy event is *after* the slot. Here the busy ends at 11:00 and the slot starts
    // at 11:00, so the after-buffer doesn't apply. before-buffer would.
    expect(slots.some((s) => s.startsAt.toISOString() === "2026-05-04T09:00:00.000Z")).toBe(true);
  });

  test("before-buffer prevents slot start too close after a prior busy", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: { ...baseMt, bufferBeforeMinutes: 15 },
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      // 10:00–11:00 Amsterdam = 08:00–09:00 UTC.
      busy: [{ start: new Date("2026-05-04T08:00:00Z"), end: new Date("2026-05-04T09:00:00Z") }],
      now: new Date("2026-05-01T00:00:00Z"),
    });
    // 11:00–11:30 slot's checked range is 10:45–11:30 → still overlaps the busy 10:00–11:00.
    expect(slots.some((s) => s.startsAt.toISOString() === "2026-05-04T09:00:00.000Z")).toBe(false);
    // 11:15–11:45 slot's checked range is 11:00–11:45 → no overlap.
    expect(slots.some((s) => s.startsAt.toISOString() === "2026-05-04T09:15:00.000Z")).toBe(true);
  });
});

describe("computeAvailableSlots — windowing", () => {
  test("respects minNoticeMinutes — slots before now+notice are excluded", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: { ...baseMt, minNoticeMinutes: 60 },
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-05T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-05-04T07:00:00Z"), // 09:00 Amsterdam
    });
    // earliest = 10:00 Amsterdam = 08:00 UTC. Slots starting before that are excluded.
    expect(slots[0].startsAt.toISOString()).toBe("2026-05-04T08:00:00.000Z");
  });

  test("respects maxAdvanceDays", () => {
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: { ...baseMt, maxAdvanceDays: 1 },
      range: {
        from: new Date("2026-05-04T00:00:00Z"),
        to: new Date("2026-05-08T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-05-04T00:00:00Z"),
    });
    // latest = 2026-05-05T00:00:00Z. So Mon (May 4) slots survive; Tue+ get cut.
    const days = new Set(slots.map((s) => s.startsAt.toISOString().slice(0, 10)));
    expect(days.has("2026-05-04")).toBe(true);
    expect(days.has("2026-05-05")).toBe(false);
  });
});

describe("computeAvailableSlots — DST", () => {
  test("UTC offsets shift correctly across DST fall-back (Amsterdam, Oct 2026)", () => {
    // Mon 2026-10-26 is the day after DST fall-back (clocks went 03:00 → 02:00 on Sun 25).
    // Working hours 09:00–17:00 Amsterdam are now CET (UTC+1). 09:00 local = 08:00 UTC.
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-10-26T00:00:00Z"),
        to: new Date("2026-10-27T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(slots[0].startsAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(slots[slots.length - 1].endsAt.toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  test("UTC offsets shift correctly across DST spring-forward (Amsterdam, Mar 2026)", () => {
    // Mon 2026-03-30 is the day after DST spring-forward. Now CEST (UTC+2).
    // 09:00 local = 07:00 UTC.
    const slots = computeAvailableSlots({
      host: baseHost,
      meetingType: baseMt,
      range: {
        from: new Date("2026-03-30T00:00:00Z"),
        to: new Date("2026-03-31T00:00:00Z"),
      },
      busy: [],
      now: new Date("2026-03-01T00:00:00Z"),
    });
    expect(slots[0].startsAt.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });
});
