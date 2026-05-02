// Auth helper for admin booking actions (retry-finalize, refund). Allowed if the caller is
// a workspace OWNER/ADMIN that can manage *any* of the booking's host's workspaces, or is the
// host themselves (so a solo host without a workspace can still recover their own paid booking).
//
// Returns the resolved booking + caller's host on success, or an HTTP error code + message.

import type { Host } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageWorkspace } from "@/lib/permissions";

export interface AdminBookingAccess {
  caller: Host;
  booking: NonNullable<Awaited<ReturnType<typeof loadBooking>>>;
}

async function loadBooking(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      meetingType: {
        select: {
          id: true,
          slug: true,
          name: true,
          routingMode: true,
          assignedHostIds: true,
          conferencingHostId: true,
          priceCents: true,
          priceCurrency: true,
        },
      },
      host: { select: { id: true, slug: true, stripeAccountId: true } },
    },
  });
}

export async function authorizeAdminBookingAction(
  caller: Host,
  bookingId: string,
): Promise<{ ok: true; data: AdminBookingAccess } | { ok: false; status: number; message: string }> {
  const booking = await loadBooking(bookingId);
  if (!booking) return { ok: false, status: 404, message: "Booking not found" };

  // The booking host themselves is always allowed.
  if (booking.hostId === caller.id) {
    return { ok: true, data: { caller, booking } };
  }

  // Otherwise: caller must share a workspace with the booking host AND be OWNER/ADMIN there.
  const callerMemberships = await prisma.workspaceMember.findMany({
    where: { hostId: caller.id },
    select: { workspaceId: true, role: true },
  });
  if (callerMemberships.length === 0) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  const manageableIds = callerMemberships
    .filter((m) => canManageWorkspace(m.role))
    .map((m) => m.workspaceId);
  if (manageableIds.length === 0) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  const sharedHostMembership = await prisma.workspaceMember.findFirst({
    where: { hostId: booking.hostId, workspaceId: { in: manageableIds } },
    select: { id: true },
  });
  if (!sharedHostMembership) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  return { ok: true, data: { caller, booking } };
}
