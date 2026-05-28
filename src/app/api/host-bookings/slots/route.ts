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

  // Resolve which hosts' calendars need to be intersected. For PERSONAL or PROJECT/SINGLE this
  // is just the caller. For PROJECT/COLLECTIVE every assigned host must be free — without this
  // step the host picker would surface times when a co-host (e.g. Martijn) is double-booked.
  // For PROJECT/ROUND_ROBIN we still only check the caller: the booking POST currently assigns
  // the row to the caller (they're booking *themselves* into the meeting), so the slot must be
  // free on their calendar — the other assigned hosts are routing candidates for the *public*
  // flow, not relevant when the host self-books.
  let relevantHostIds: string[] = [caller.id];
  if (meetingType.scope === "PROJECT" && meetingType.routingMode === "COLLECTIVE") {
    const ids = new Set<string>(meetingType.assignedHostIds);
    ids.add(caller.id); // defensive: caller might not be in assignedHostIds for an outsider-led booking
    relevantHostIds = Array.from(ids);
  }

  const hosts = await prisma.host.findMany({
    where: { id: { in: relevantHostIds } },
    include: { calendars: true },
  });
  const caller_host = hosts.find((h) => h.id === caller.id);
  if (!caller_host || !caller_host.googleRefreshToken) {
    return NextResponse.json({ slots: [] });
  }

  // Per-project working-hours overrides — same resolution as the public flow's availability.
  const projectMemberOverrideByHostId = new Map<string, unknown>();
  if (meetingType.scope === "PROJECT" && meetingType.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: meetingType.projectId, hostId: { in: relevantHostIds } },
      select: { hostId: true, workingHoursOverride: true },
    });
    for (const m of members) projectMemberOverrideByHostId.set(m.hostId, m.workingHoursOverride);
  }

  // Compute each participant's available slots, then intersect. Skip hosts with no Google
  // connection — they can't be considered "free" so we omit them rather than treating them as
  // always-available (which would surface phantom slots).
  const perHostSlots = await Promise.all(
    hosts.map(async (h) => {
      if (!h.googleRefreshToken) return null;
      const busy = await fetchHostBusy(h, { from, to: effectiveTo }, meetingType);
      return computeAvailableSlots({
        host: {
          timezone: h.timezone,
          workingHours: effectiveWorkingHours(
            meetingType,
            h,
            projectMemberOverrideByHostId.get(h.id),
          ),
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
    }),
  );

  // For COLLECTIVE we intersect — a slot is offered only when present in EVERY participant's
  // availability. For SINGLE this is trivially just the caller's slot list.
  const callerSlots = perHostSlots[hosts.findIndex((h) => h.id === caller.id)] ?? [];
  let slots = callerSlots;
  if (meetingType.scope === "PROJECT" && meetingType.routingMode === "COLLECTIVE") {
    for (const otherSlots of perHostSlots) {
      if (otherSlots === null) {
        // A required participant has no Google connection — there's no defensible slot list
        // to show. Return empty + let the UI surface the "no availability" copy.
        slots = [];
        break;
      }
      const otherKeys = new Set(otherSlots.map((s) => s.startsAt.getTime()));
      slots = slots.filter((s) => otherKeys.has(s.startsAt.getTime()));
    }
  }

  return NextResponse.json({
    slots: slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
    timezone: caller_host.timezone,
    durationMinutes: meetingType.durationMinutes,
  });
}
