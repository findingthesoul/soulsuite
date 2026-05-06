import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { prisma } from "@/lib/prisma";
import type { BusyInterval } from "./engine";

interface HostInput {
  // Identity used for caching. Optional so existing callers without a hostId still work.
  id?: string;
  googleRefreshToken: string | null;
  calendars: { id: string; googleCalendarId: string; role: "PRIMARY" | "CONFLICT_CHECK" | "WRITE_TARGET" }[];
}

// In-memory freebusy cache. Brief §"Rate limits" wants a 60-second per-host cache so public
// booking page renders don't fan out one Google call per host on every refresh. Keyed on
// (hostId, sortedCalendarIds, range bucket). Lives per serverless instance — good enough to
// cushion bursts on a warm function; cold starts pay the freebusy cost once.
interface CacheEntry {
  expiresAt: number;
  busy: BusyInterval[];
}
const FREEBUSY_TTL_MS = 60_000;
const _freebusyCache = new Map<string, CacheEntry>();

function freebusyCacheKey(hostId: string, calendars: HostInput["calendars"], from: Date, to: Date): string {
  const ids = calendars.map((c) => c.googleCalendarId).sort().join(",");
  // 30-second buckets so adjacent renders land on the same cache slot.
  const bucket = 30_000;
  return `${hostId}|${ids}|${Math.floor(from.getTime() / bucket)}|${Math.floor(to.getTime() / bucket)}`;
}

export function bustFreebusyCacheForHost(hostId: string): void {
  for (const k of _freebusyCache.keys()) {
    if (k.startsWith(`${hostId}|`)) _freebusyCache.delete(k);
  }
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
 * Cached for 60s per (hostId, calendars, range bucket) when the host has an `id`. Booking
 * writes call `bustFreebusyCacheForHost(hostId)` to invalidate.
 */
export async function fetchHostBusy(
  host: HostInput,
  range: { from: Date; to: Date },
  meetingType?: { conflictCalendarIds?: string[] },
): Promise<BusyInterval[]> {
  if (!host.googleRefreshToken) return [];
  const effective = resolveConflictCalendars(host.calendars, meetingType);
  if (effective.length === 0) return [];

  // Cache only covers the Google freebusy result. Pending-approval bookings are layered on
  // *after* the cache lookup so changes to pending state aren't masked by a stale TTL.
  const cacheable = !!host.id;
  const cacheKey = cacheable ? freebusyCacheKey(host.id!, effective, range.from, range.to) : null;
  let googleBusy: BusyInterval[];
  const hit = cacheKey ? _freebusyCache.get(cacheKey) : null;
  if (hit && hit.expiresAt > Date.now()) {
    googleBusy = hit.busy;
  } else {
    const cal = calendarFor(host.googleRefreshToken);
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString(),
        items: effective.map((c) => ({ id: c.googleCalendarId })),
      },
    });
    googleBusy = [];
    for (const c of effective) {
      const data = res.data.calendars?.[c.googleCalendarId];
      for (const b of data?.busy ?? []) {
        if (b.start && b.end) googleBusy.push({ start: new Date(b.start), end: new Date(b.end) });
      }
    }
    if (cacheKey) _freebusyCache.set(cacheKey, { busy: googleBusy, expiresAt: Date.now() + FREEBUSY_TTL_MS });
  }

  // Pending-approval bookings have no Google event yet, so freebusy doesn't see them. Treat
  // them as busy on the requested host so the slot disappears from the picker until the host
  // approves or declines. Queried outside the freebusy cache so flips show up immediately.
  if (host.id) {
    const pending = await fetchPendingApprovalBusy(host.id, range);
    return [...googleBusy, ...pending];
  }
  return googleBusy;
}

async function fetchPendingApprovalBusy(
  hostId: string,
  range: { from: Date; to: Date },
): Promise<BusyInterval[]> {
  const rows = await prisma.booking.findMany({
    where: {
      hostId,
      status: "PENDING_APPROVAL",
      startsAt: { lt: range.to },
      endsAt: { gt: range.from },
    },
    select: { startsAt: true, endsAt: true },
  });
  return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
}

export { isGoogleAuthError };
