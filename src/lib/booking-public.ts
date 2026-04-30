// Resolver shared by every public booking page (confirmed / cancel / reschedule). Knows how to
// match a URL like /{slug}/{mtSlug}/confirmed/{bookingId} for both PERSONAL hosts and PROJECT
// scopes — the URL slug can be either a Host.slug or a Project.slug.

import { prisma } from "@/lib/prisma";

export async function resolvePublicBooking(slug: string, mtSlug: string, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { host: true, meetingType: true, project: true },
  });
  if (!booking) return null;
  if (booking.meetingType.slug !== mtSlug) return null;

  // Match either against the assigned host's slug (PERSONAL) or the project's slug (PROJECT).
  if (booking.meetingType.scope === "PROJECT") {
    if (!booking.project || booking.project.slug !== slug) return null;
  } else {
    if (booking.host.slug !== slug) return null;
  }

  return booking;
}
