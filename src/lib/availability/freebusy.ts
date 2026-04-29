import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import type { BusyInterval } from "./engine";

interface HostInput {
  googleRefreshToken: string | null;
  calendars: { id: string; googleCalendarId: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" }[];
}

/**
 * Resolves which of the host's calendars should be queried for conflicts when computing
 * availability for a specific meeting type.
 *
 * - When `meetingType.conflictCalendarIds` is non-empty, restrict to those (intersected with
 *   the host's actual calendars — defends against stale references).
 * - Otherwise default to all CONFLICT_CHECK + WRITE_TARGET roles.
 */
export function resolveConflictCalendars(
  hostCalendars: HostInput["calendars"],
  meetingType?: { conflictCalendarIds?: string[] },
): HostInput["calendars"] {
  const override = meetingType?.conflictCalendarIds ?? [];
  if (override.length > 0) {
    const allow = new Set(override);
    return hostCalendars.filter((c) => allow.has(c.id));
  }
  return hostCalendars.filter((c) => c.role === "CONFLICT_CHECK" || c.role === "WRITE_TARGET");
}

/**
 * Fetches busy intervals for a host. Brief §6 + §9: query all conflict sources via
 * `freebusy.query` (one batched call, up to 50 calendars). Pass `meetingType` to honour the
 * per-meeting-type calendar override.
 *
 * Throws on revoked credentials — callers catch and surface "needs re-auth" (brief §Token rotation).
 *
 * V1: no caching. Brief §Rate limits suggests a 60-second cache per host; add later if we
 * hit Google's ~500-req/100-sec/user limit.
 */
export async function fetchHostBusy(
  host: HostInput,
  range: { from: Date; to: Date },
  meetingType?: { conflictCalendarIds?: string[] },
): Promise<BusyInterval[]> {
  if (!host.googleRefreshToken) return [];
  const effective = resolveConflictCalendars(host.calendars, meetingType);
  if (effective.length === 0) return [];

  const cal = calendarFor(host.googleRefreshToken);
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      items: effective.map((c) => ({ id: c.googleCalendarId })),
    },
  });

  const out: BusyInterval[] = [];
  for (const c of effective) {
    const data = res.data.calendars?.[c.googleCalendarId];
    for (const b of data?.busy ?? []) {
      if (b.start && b.end) out.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  return out;
}

export { isGoogleAuthError };
