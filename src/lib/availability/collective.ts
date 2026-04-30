// Collective availability — every assigned host must be free for a slot to be offered.
//
// Unlike round-robin (union), collective is the INTERSECTION of host availability: the slot is
// only bookable if all hosts can attend. Booking creates ONE event on the deterministic
// "saving host" with all other assigned hosts added as Google Calendar attendees so the Meet
// link works for everyone, and a single Zoom meeting on the saving host's account.

import type { MeetingType, Host, Calendar } from "@prisma/client";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";

export interface CollectiveSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Compute the intersection of every host's availability for a meeting type. A slot is only
 * returned if every host has it free.
 */
export async function computeCollectiveSlots(
  meetingType: MeetingType,
  hosts: (Host & { calendars: Calendar[] })[],
  range: { from: Date; to: Date },
): Promise<CollectiveSlot[]> {
  if (hosts.length === 0) return [];

  const perHost = await Promise.all(
    hosts.map(async (h) => {
      const slots = await getAvailableSlotsForMeetingType(meetingType, h, range);
      return { hostId: h.id, set: new Set(slots.map((s) => s.startsAt.getTime())), slots };
    }),
  );

  // Intersect all host sets, anchored on the first host's slots so we keep startsAt/endsAt.
  const out: CollectiveSlot[] = [];
  for (const slot of perHost[0].slots) {
    const ms = slot.startsAt.getTime();
    if (perHost.every((p) => p.set.has(ms))) {
      out.push({ startsAt: slot.startsAt, endsAt: slot.endsAt });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
