// Composes the pure engine + freebusy + DB lookups. Use from server components and route
// handlers. The pure engine itself stays in ./engine.ts so tests don't need DB or network.

import type { MeetingType, Host, Calendar } from "@prisma/client";
import { computeAvailableSlots, type AvailableSlot, type WorkingHours } from "./engine";
import { fetchHostBusy } from "./freebusy";

export type { AvailableSlot } from "./engine";

/**
 * Resolve the working-hours schedule the engine should use for `meetingType` on `host`.
 * Resolution order:
 *   1. `meetingType.workingHoursOverride` if set
 *   2. `projectMemberOverride` if set (i.e. the host has per-team hours for this project)
 *   3. `host.workingHours`
 * Empty objects are treated as "no override" so a half-finished override doesn't lock
 * everyone out of bookings.
 */
export function effectiveWorkingHours(
  meetingType: { workingHoursOverride?: unknown },
  host: { workingHours: unknown },
  projectMemberOverride?: unknown,
): WorkingHours {
  const mtOverride = meetingType.workingHoursOverride as WorkingHours | null | undefined;
  if (mtOverride && typeof mtOverride === "object" && Object.keys(mtOverride).length > 0) {
    return mtOverride;
  }
  const pmOverride = projectMemberOverride as WorkingHours | null | undefined;
  if (pmOverride && typeof pmOverride === "object" && Object.keys(pmOverride).length > 0) {
    return pmOverride;
  }
  return ((host.workingHours as WorkingHours | null) ?? {}) as WorkingHours;
}

/**
 * Look up the host's per-project working-hours override for a given project, if any.
 * Returns null when the host isn't a member of the project, or when no override is set.
 */
export async function getProjectMemberWorkingHoursOverride(
  hostId: string,
  projectId: string,
): Promise<WorkingHours | null> {
  const { prisma } = await import("@/lib/prisma");
  const member = await prisma.projectMember.findUnique({
    where: { projectId_hostId: { projectId, hostId } },
    select: { workingHoursOverride: true },
  });
  const wh = member?.workingHoursOverride as WorkingHours | null | undefined;
  if (wh && typeof wh === "object" && Object.keys(wh).length > 0) return wh;
  return null;
}

interface ResolvedHost extends Host {
  calendars: Calendar[];
}

export async function getAvailableSlotsForMeetingType(
  meetingType: MeetingType,
  host: ResolvedHost,
  range: { from: Date; to: Date },
): Promise<AvailableSlot[]> {
  // For project-scoped meeting types, fall back through the host's per-project working-hours
  // override before the host's global default — only consulted when the MT-level override is unset.
  let projectMemberOverride: WorkingHours | null = null;
  if (meetingType.scope === "PROJECT" && meetingType.projectId) {
    projectMemberOverride = await getProjectMemberWorkingHoursOverride(host.id, meetingType.projectId);
  }
  const wh = effectiveWorkingHours(meetingType, host, projectMemberOverride);
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
