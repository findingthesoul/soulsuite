import type { Prisma } from "@prisma/client";

// "Bookings this host should see in their personal lists" — that's:
//   1. Bookings where they're the booking host of record (Booking.hostId), AND
//   2. COLLECTIVE meeting types where they're listed in assignedHostIds — the meeting belongs
//      to them as a co-host even though one designated host owns the calendar event.
//
// Returns a Prisma `where` fragment ready to spread alongside other filters:
//   prisma.booking.findMany({
//     where: { ...visibleToHostWhere(hostId), startsAt: { gte: now } },
//   })
//
// Round-robin doesn't need this branch — there's a single assigned host per booking and that's
// already the Booking.hostId. SINGLE is the same. The OR clause only matters for COLLECTIVE.
export function visibleToHostWhere(hostId: string): Prisma.BookingWhereInput {
  return {
    OR: [
      { hostId },
      {
        meetingType: {
          routingMode: "COLLECTIVE",
          assignedHostIds: { has: hostId },
        },
      },
    ],
  };
}
