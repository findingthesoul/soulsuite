import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import type { BusyInterval } from "./engine";

interface HostInput {
  googleRefreshToken: string | null;
  calendars: { googleCalendarId: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" }[];
}

/**
 * Fetches busy intervals for a host across all conflict-source + write-target calendars.
 * Brief §6 + §9: query all conflict sources via `freebusy.query` (one call, up to 50 calendars).
 *
 * Throws if the host's Google credentials were revoked — callers should catch and surface
 * "needs re-auth" to the host (brief §Token rotation).
 *
 * V1: no caching. Brief §Rate limits suggests a 60-second cache per host; add later if we
 * see API limit pressure (Google allows ~500 queries / 100 sec / user).
 */
export async function fetchHostBusy(
  host: HostInput,
  range: { from: Date; to: Date },
): Promise<BusyInterval[]> {
  if (!host.googleRefreshToken) return [];
  const calendarIds = host.calendars
    .filter((c) => c.role === "CONFLICT_CHECK" || c.role === "WRITE_TARGET")
    .map((c) => c.googleCalendarId);
  if (calendarIds.length === 0) return [];

  const cal = calendarFor(host.googleRefreshToken);
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const out: BusyInterval[] = [];
  for (const id of calendarIds) {
    const cal = res.data.calendars?.[id];
    for (const b of cal?.busy ?? []) {
      if (b.start && b.end) out.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  return out;
}

export { isGoogleAuthError };
