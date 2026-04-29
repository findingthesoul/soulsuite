// Minimal IANA-timezone utilities backed by Intl.DateTimeFormat.
// Avoids pulling in date-fns-tz / luxon for ~40 lines of focused logic.

/**
 * Returns the offset (in minutes) at the given UTC instant for `timeZone`.
 * Positive when the zone is east of UTC. Handles DST.
 *
 *   localTime = utcTime + offsetMinutes
 */
export function getTimezoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asUTC - utcMs) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
 * Iterative correction handles DST transition days.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Treat the wall-clock time as UTC to get a first guess.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = getTimezoneOffsetMinutes(naive, timeZone);
  let utcMs = naive - offset1 * 60000;
  // Re-check at the new instant — DST transitions can change the offset.
  const offset2 = getTimezoneOffsetMinutes(utcMs, timeZone);
  if (offset2 !== offset1) utcMs = naive - offset2 * 60000;
  return new Date(utcMs);
}

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Monday … 6 = Sunday (matches WorkingHours JSON keys)
}

/** Returns the calendar parts for `utcMs` as observed in `timeZone`. */
export function utcToZonedParts(utcMs: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const wdMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: wdMap[map.weekday],
  };
}
