// Composes the pure engine + freebusy + DB lookups. Use from server components and route
// handlers. The pure engine itself stays in ./engine.ts so tests don't need DB or network.

import type { MeetingType, Host, Calendar } from "@prisma/client";
import { computeAvailableSlots, type AvailableSlot, type WorkingHours } from "./engine";
import { fetchHostBusy } from "./freebusy";

export type { AvailableSlot } from "./engine";

/**
 * Resolve the working-hours schedule the engine should use for `meetingType` on `host`.
 * Per-meeting-type overrides win when set; otherwise we fall back to the host's default
 * weekly schedule. Empty objects are treated as "no override" so a half-finished override
 * doesn't lock everyone out of bookings.
 */
export function effectiveWorkingHours(
  meetingType: { workingHoursOverride?: unknown },
  host: { workingHours: unknown },
): WorkingHours {
  const override = meetingType.workingHoursOverride as WorkingHours | null | undefined;
  if (override && typeof override === "object" && Object.keys(override).length > 0) {
    return override;
  }
  return ((host.workingHours as WorkingHours | null) ?? {}) as WorkingHours;
}

interface ResolvedHost extends Host {
  calendars: Calendar[];
}

export async function getAvailableSlotsForMeetingType(
  meetingType: MeetingType,
  host: ResolvedHost,
  range: { from: Date; to: Date },
): Promise<AvailableSlot[]> {
  const wh = effectiveWorkingHours(meetingType, host);
  const busy = await fetchHostBusy(host, range, meetingType);
  return computeAvailableSlots({
    host: { timezone: host.timezone, workingHours: wh },
    meetingType: {
      durationMinutes: meetingType.durationMinutes,
      bufferBeforeMinutes: meetingType.bufferBeforeMinutes,
      bufferAfterMinutes: meetingType.bufferAfterMinutes,
      minNoticeMinutes: meetingType.minNoticeMinutes,
      maxAdvanceDays: meetingType.maxAdvanceDays,
    },
    range,
    busy,
  });
}
