// Round-robin helpers. Per-Team fairness rule lives on Project.roundRobinFairness:
//   LEAST_RECENTLY_ASSIGNED (default) — oldest ProjectMember.lastAssignedAt wins (nulls first),
//     tie-broken by addedAt for stable behaviour. This was the historic only-rule.
//   LEAST_LOADED — host with the fewest upcoming CONFIRMED bookings in the next 14 days. Uses
//     a Booking count (cheap, indexed by hostId+startsAt) rather than a freebusy fan-out.
//     Tie-broken by least-recently-assigned, then addedAt.
//   STRICT_ROTATION — pick the host whose id sits next after the meeting type's most recent
//     booking in assignedHostIds order, wrapping. Falls back to assignedHostIds[0] when there
//     is no prior booking. If the "next" host isn't a free candidate (already busy), we keep
//     advancing through the rotation until we find one that is.
//   RANDOM — cryptographically uniform pick from the candidates.
//
// All rules update Host/ProjectMember.lastAssignedAt downstream (the booking transaction does
// that — see src/app/api/bookings/route.ts), so the field stays meaningful as a tie-breaker
// regardless of which rule was active.

import { randomInt } from "crypto";
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
// all free at the requested time. Reads Project.roundRobinFairness to choose the rule.
//
// `meetingTypeId` and `assignedHostIds` are needed for STRICT_ROTATION (it looks at the most
// recent Booking on the meeting type to find "last assigned").
export async function pickRoundRobinHost(
  projectId: string,
  candidateHostIds: string[],
  options?: { meetingTypeId?: string; assignedHostIds?: string[] },
): Promise<string | null> {
  if (candidateHostIds.length === 0) return null;
  if (candidateHostIds.length === 1) return candidateHostIds[0];

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { roundRobinFairness: true },
  });
  const rule = project?.roundRobinFairness ?? "LEAST_RECENTLY_ASSIGNED";

  switch (rule) {
    case "RANDOM": {
      // randomInt is uniform; preserve it cryptographically rather than Math.random so audit
      // logs don't show seeded duplicates.
      return candidateHostIds[randomInt(0, candidateHostIds.length)];
    }
    case "STRICT_ROTATION": {
      const order = options?.assignedHostIds ?? [];
      // If we don't know the canonical order, we can't rotate — fall back to LRA.
      if (order.length === 0) return await pickLeastRecentlyAssigned(projectId, candidateHostIds);

      let lastAssignedHostId: string | null = null;
      if (options?.meetingTypeId) {
        const lastBooking = await prisma.booking.findFirst({
          where: { meetingTypeId: options.meetingTypeId, status: "CONFIRMED" },
          orderBy: { createdAt: "desc" },
          select: { hostId: true },
        });
        lastAssignedHostId = lastBooking?.hostId ?? null;
      }

      const startIdx =
        lastAssignedHostId !== null && order.includes(lastAssignedHostId)
          ? (order.indexOf(lastAssignedHostId) + 1) % order.length
          : 0;
      // Walk forward through the rotation until we find someone in the candidate set.
      const candidateSet = new Set(candidateHostIds);
      for (let i = 0; i < order.length; i++) {
        const id = order[(startIdx + i) % order.length];
        if (candidateSet.has(id)) return id;
      }
      // No assigned host is in the candidate set (shouldn't happen — candidates are drawn from
      // assignedHostIds upstream). Fall back to LRA among candidates.
      return await pickLeastRecentlyAssigned(projectId, candidateHostIds);
    }
    case "LEAST_LOADED": {
      // Count CONFIRMED bookings per candidate host in the next 14 days. Uses the existing
      // Booking @@index([hostId, status, startsAt]). Tie-break with LRA + addedAt.
      const now = new Date();
      const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const [groups, members] = await Promise.all([
        prisma.booking.groupBy({
          by: ["hostId"],
          where: {
            hostId: { in: candidateHostIds },
            status: "CONFIRMED",
            startsAt: { gte: now, lt: horizon },
          },
          _count: { _all: true },
        }),
        prisma.projectMember.findMany({
          where: { projectId, hostId: { in: candidateHostIds } },
          orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { addedAt: "asc" }],
        }),
      ]);
      const loadByHost = new Map<string, number>();
      for (const id of candidateHostIds) loadByHost.set(id, 0);
      for (const g of groups) loadByHost.set(g.hostId, g._count._all);

      // members[] is already sorted by LRA + addedAt; pick the first whose load is minimal.
      let minLoad = Infinity;
      for (const id of candidateHostIds) {
        const l = loadByHost.get(id) ?? 0;
        if (l < minLoad) minLoad = l;
      }
      const winner = members.find((m) => (loadByHost.get(m.hostId) ?? 0) === minLoad);
      return winner?.hostId ?? candidateHostIds[0];
    }
    case "LEAST_RECENTLY_ASSIGNED":
    default:
      return await pickLeastRecentlyAssigned(projectId, candidateHostIds);
  }
}

async function pickLeastRecentlyAssigned(
  projectId: string,
  candidateHostIds: string[],
): Promise<string | null> {
  const members = await prisma.projectMember.findMany({
    where: { projectId, hostId: { in: candidateHostIds } },
    orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { addedAt: "asc" }],
  });
  return members[0]?.hostId ?? null;
}
