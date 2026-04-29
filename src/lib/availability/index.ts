// Composes the pure engine + freebusy + DB lookups. Use from server components and route
// handlers. The pure engine itself stays in ./engine.ts so tests don't need DB or network.

import type { MeetingType, Host, Calendar } from "@prisma/client";
import { computeAvailableSlots, type AvailableSlot, type WorkingHours } from "./engine";
import { fetchHostBusy } from "./freebusy";

export type { AvailableSlot } from "./engine";

interface ResolvedHost extends Host {
  calendars: Calendar[];
}

export async function getAvailableSlotsForMeetingType(
  meetingType: MeetingType,
  host: ResolvedHost,
  range: { from: Date; to: Date },
): Promise<AvailableSlot[]> {
  const wh = (host.workingHours as WorkingHours | null) ?? {};
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
