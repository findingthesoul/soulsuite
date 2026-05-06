// Shared logic for approving or declining a PENDING_APPROVAL booking. Both the public
// token-gated routes and the authenticated admin routes funnel through here so the side effects
// (Google event creation on approve, decline email) stay in one place.

import { prisma } from "@/lib/prisma";
import { finalizeBooking } from "@/lib/bookings/finalize";
import { bookingDeclinedTemplate, sendEmail } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";

export type ApproveResult =
  | { ok: true; status: "ALREADY_CONFIRMED" }
  | { ok: true; status: "APPROVED"; bookingId: string }
  | { ok: false; status: number; message: string };

interface ApproveArgs {
  bookingId: string;
  decidedByHostId: string;
  // Best-effort timezone for the invitee email (matches the public booking POST). The original
  // booking didn't capture this, so we fall back to UTC for now.
  inviteeTimezone?: string;
}

export async function approvePendingBooking(args: ApproveArgs): Promise<ApproveResult> {
  const booking = await prisma.booking.findUnique({ where: { id: args.bookingId } });
  if (!booking) return { ok: false, status: 404, message: "Booking not found" };
  if (booking.status === "CONFIRMED") {
    return { ok: true, status: "ALREADY_CONFIRMED" };
  }
  if (booking.status !== "PENDING_APPROVAL") {
    return { ok: false, status: 409, message: "This booking is not awaiting approval." };
  }

  // Flip to CONFIRMED first so finalizeBooking() doesn't see PENDING_APPROVAL state. The
  // finalize path expects CONFIRMED-or-paid bookings; approving is the only way to leave the
  // pending state via this path.
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CONFIRMED",
      approvedAt: new Date(),
      approvalDecidedByHostId: args.decidedByHostId,
    },
  });

  const result = await finalizeBooking({
    bookingId: booking.id,
    hostId: booking.hostId,
    collectiveCoHostIds: [],
    inviteeTimezone: args.inviteeTimezone ?? "UTC",
  });
  if (!result.ok) {
    // finalize already cleaned up (deleted the row or marked CANCELLED) on its failure paths.
    return { ok: false, status: result.status, message: result.message };
  }
  return { ok: true, status: "APPROVED", bookingId: booking.id };
}

export type DeclineResult =
  | { ok: true; status: "ALREADY_DECLINED" }
  | { ok: true; status: "DECLINED" }
  | { ok: false; status: number; message: string };

interface DeclineArgs {
  bookingId: string;
  decidedByHostId: string;
}

export async function declinePendingBooking(args: DeclineArgs): Promise<DeclineResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      meetingType: { select: { name: true } },
      host: { select: { name: true, email: true } },
    },
  });
  if (!booking) return { ok: false, status: 404, message: "Booking not found" };
  if (booking.status === "CANCELLED") {
    return { ok: true, status: "ALREADY_DECLINED" };
  }
  if (booking.status !== "PENDING_APPROVAL") {
    return { ok: false, status: 409, message: "This booking is not awaiting approval." };
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      approvalDecidedByHostId: args.decidedByHostId,
    },
  });

  // Free a one-off slot if this was on one — release the claim so the slot is bookable again.
  await prisma.oneOffSlot
    .updateMany({
      where: { bookedBookingId: booking.id },
      data: { bookedBookingId: null },
    })
    .catch(() => undefined);

  const logoUrl = await getEmailLogoUrl();
  const tmpl = bookingDeclinedTemplate({
    hostName: booking.host.name,
    meetingTypeName: booking.meetingType.name,
    startsAtIso: booking.startsAt.toISOString(),
    endsAtIso: booking.endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    logoUrl,
  });
  void sendEmail({
    to: booking.inviteeEmail,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    fromName: booking.host.name,
    replyTo: booking.host.email,
  });
  return { ok: true, status: "DECLINED" };
}
