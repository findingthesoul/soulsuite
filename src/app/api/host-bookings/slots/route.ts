// GET /api/host-bookings/slots?mtId=...&from=ISO&to=ISO
//
// Returns the host's available slots for a meeting type in the given range. Powers the
// availability picker on /dashboard/book so the host can only pick a real free slot instead
// of typing a datetime-local that the server then rejects.
//
// Auth: signed-in host who owns the MT (personal) or is on its project. Uses the same
// freebusy + working-hours engine as the public booking flow, so the answers line up.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { effectiveWorkingHours } from "@/lib/availability";

export async function GET(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const mtId = request.nextUrl.searchParams.get("mtId");
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  if (!mtId) return NextResponse.json({ error: "mtId required" }, { status: 400 });

  const now = new Date();
  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam ? new Date(toParam) : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to.getTime() <= from.getTime()) {
    return NextResponse.json({ error: "invalid from/to" }, { status: 400 });
  }
  // Hard cap to 60 days so a bad caller can't blow up freebusy quota.
  const maxTo = new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);
  const effectiveTo = to.getTime() > maxTo.getTime() ? maxTo : to;

  const meetingType = await prisma.meetingType.findUnique({ where: { id: mtId } });
  if (!meetingType || !meetingType.isActive) {
    return NextResponse.json({ error: "meeting type not found" }, { status: 404 });
  }

  // Same access rule as the booking POST: own the MT, or be a member of its project.
  if (meetingType.scope === "PERSONAL") {
    if (meetingType.hostId !== caller.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (meetingType.projectId) {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_hostId: { projectId: meetingType.projectId, hostId: caller.id } },
    });
    if (!m) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const host = await prisma.host.findUnique({
    where: { id: caller.id },
    include: { calendars: true },
  });
  if (!host || !host.googleRefreshToken) {
    return NextResponse.json({ slots: [] });
  }

  const busy = await fetchHostBusy(host, { from, to: effectiveTo }, meetingType);
  const slots = computeAvailableSlots({
    host: {
      timezone: host.timezone,
      workingHours: effectiveWorkingHours(meetingType, host, undefined),
    },
    meetingType: {
      durationMinutes: meetingType.durationMinutes,
      bufferBeforeMinutes: meetingType.bufferBeforeMinutes,
      bufferAfterMinutes: meetingType.bufferAfterMinutes,
      minNoticeMinutes: meetingType.minNoticeMinutes,
      maxAdvanceDays: meetingType.maxAdvanceDays,
    },
    range: { from, to: effectiveTo },
    busy,
  });
  return NextResponse.json({
    slots: slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
    timezone: host.timezone,
    durationMinutes: meetingType.durationMinutes,
  });
}
