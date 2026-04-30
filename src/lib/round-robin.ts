// Round-robin helpers. Brief §"Round-robin fairness": default rule is least-recently-assigned —
// the project member with the oldest `lastAssignedAt` (or never-assigned) goes next, broken by
// stable insertion order if multiple are tied.

import { prisma } from "@/lib/prisma";
import type { Host, Calendar } from "@prisma/client";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";
import type { MeetingType } from "@prisma/client";

export interface RoundRobinSlot {
  startsAt: Date;
  endsAt: Date;
  // Hosts whose calendars are free at this slot. Picker uses this list at booking time.
  candidateHostIds: string[];
}

// Compute the union of available slots across multiple hosts. A slot is available if AT LEAST
// ONE host is free for it; we record which hosts can take it so the booking endpoint can pick
// using the fairness rule without re-fetching freebusy.
export async function computeRoundRobinSlots(
  meetingType: MeetingType,
  hosts: (Host & { calendars: Calendar[] })[],
  range: { from: Date; to: Date },
): Promise<RoundRobinSlot[]> {
  const perHost = await Promise.all(
    hosts.map(async (h) => {
      // We want availability per host, computed against THEIR calendars + working hours. The
      // availability lib already accepts a single host, so we run it once per host.
      const slots = await getAvailableSlotsForMeetingType(meetingType, h, range);
      return { hostId: h.id, slots };
    }),
  );

  // Bucket by start time (ms since epoch); end time is implied by duration.
  const byStart = new Map<number, RoundRobinSlot>();
  for (const { hostId, slots } of perHost) {
    for (const slot of slots) {
      const key = slot.startsAt.getTime();
      const existing = byStart.get(key);
      if (existing) {
        if (!existing.candidateHostIds.includes(hostId)) existing.candidateHostIds.push(hostId);
      } else {
        byStart.set(key, {
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          candidateHostIds: [hostId],
        });
      }
    }
  }

  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// Pick the host to assign for a fresh round-robin booking, given a list of candidates that are
// all free at the requested time. Default fairness: least-recently-assigned wins; never-assigned
// (null) ranks oldest. Tie-breaker: ProjectMember.addedAt ascending (stable insertion order).
export async function pickRoundRobinHost(
  projectId: string,
  candidateHostIds: string[],
): Promise<string | null> {
  if (candidateHostIds.length === 0) return null;
  if (candidateHostIds.length === 1) return candidateHostIds[0];

  const members = await prisma.projectMember.findMany({
    where: { projectId, hostId: { in: candidateHostIds } },
    orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { addedAt: "asc" }],
  });
  return members[0]?.hostId ?? null;
}
