// Public token-gated decline endpoint — counterpart to /approve. Cancels a PENDING_APPROVAL
// booking and emails the invitee a "your request was declined" notice.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { declinePendingBooking } from "@/lib/bookings/approve";
import { publicEnv } from "@/lib/env";

async function handle(request: NextRequest, id: string): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Missing token.", { status: 400 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { approvalToken: true, hostId: true, meetingType: { select: { slug: true } }, host: { select: { slug: true } }, project: { select: { slug: true } } },
  });
  if (!booking || !booking.approvalToken || booking.approvalToken !== token) {
    return new NextResponse("Invalid or expired link.", { status: 403 });
  }

  const result = await declinePendingBooking({
    bookingId: id,
    decidedByHostId: booking.hostId,
  });
  if (!result.ok) return new NextResponse(result.message, { status: result.status });

  if (request.method === "GET") {
    const slug = booking.project?.slug ?? booking.host.slug;
    const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/${slug}/${booking.meetingType.slug}/confirmed/${id}?declined=1`;
    return NextResponse.redirect(url, 303);
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(request, id);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(request, id);
}
