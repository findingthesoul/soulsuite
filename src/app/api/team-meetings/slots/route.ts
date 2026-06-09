// GET /api/team-meetings/slots?attendeeIds=A,B,C&durationMinutes=30&from=ISO&to=ISO
//
// Returns conflict-annotated candidate slots for an ad-hoc team meeting. Powers the slot picker
// on /dashboard/team-meeting — the caller picks teammates and a duration, this endpoint returns
// every slot within the caller's working hours over the requested range, each tagged with the
// list of attendees who are free vs. busy at that time.
//
// We don't intersect like a hard filter would, because for teams of 4-5 the intersection is
// usually empty — strict mutual availability is the wrong default for internal meetings. By
// surfacing conflicts as data instead, the caller can either book a slot where everyone is
// free OR pick a handful of "best effort" slots and send them as a poll to negotiate.
//
// Slots are generated against the CALLER's working hours + freebusy (the caller is the
// organiser; if they're busy at a slot it's not a useful candidate). Per-attendee free/busy
// then comes from running the same engine on each attendee's calendar.
//
// Auth: signed-in host. The caller is implicitly added to the attendee set if they're not
// already in it (you can't book a meeting you're not at). All attendees must share at least
// one workspace with the caller — prevents cross-workspace fishing for someone's availability.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchHostBusy } from "@/lib/availability/freebusy";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { effectiveWorkingHours } from "@/lib/availability";

const ALLOWED_DURATIONS = new Set([15, 30, 45, 60, 90, 120]);

export async function GET(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = request.nextUrl;
  const attendeeIdsParam = url.searchParams.get("attendeeIds");
  const durationParam = url.searchParams.get("durationMinutes");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const attendeeIds = Array.from(
    new Set(
      (attendeeIdsParam ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (attendeeIds.length === 0) {
    return NextResponse.json({ error: "attendeeIds required" }, { status: 400 });
  }
  const durationMinutes = Number(durationParam);
  if (!ALLOWED_DURATIONS.has(durationMinutes)) {
    return NextResponse.json({ error: "durationMinutes must be 15/30/45/60/90/120" }, { status: 400 });
  }

  const now = new Date();
  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam ? new Date(toParam) : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to.getTime() <= from.getTime()) {
    return NextResponse.json({ error: "invalid from/to" }, { status: 400 });
  }
  // Hard cap to 60 days so a misuse can't blow up Google freebusy quota.
  const maxTo = new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);
  const effectiveTo = to.getTime() > maxTo.getTime() ? maxTo : to;

  // Implicitly include the caller — you can't book a meeting you're not attending.
  const allIds = Array.from(new Set([caller.id, ...attendeeIds]));

  // Cross-workspace defence: every attendee must share at least one workspace with the caller.
  // We pull the caller's workspace memberships, then verify each attendee has one of those
  // workspace ids. Keeps a determined attacker from probing arbitrary host calendars by id.
  const callerMemberships = await prisma.workspaceMember.findMany({
    where: { hostId: caller.id },
    select: { workspaceId: true },
  });
  const callerWorkspaceIds = new Set(callerMemberships.map((m) => m.workspaceId));
  if (callerWorkspaceIds.size === 0) {
    return NextResponse.json({ error: "Caller has no workspace." }, { status: 403 });
  }
  const memberships = await prisma.workspaceMember.findMany({
    where: { hostId: { in: allIds }, workspaceId: { in: Array.from(callerWorkspaceIds) } },
    select: { hostId: true },
  });
  const sharedHostIds = new Set(memberships.map((m) => m.hostId));
  for (const id of attendeeIds) {
    if (!sharedHostIds.has(id)) {
      return NextResponse.json(
        { error: "One or more attendees aren't in your workspace." },
        { status: 403 },
      );
    }
  }

  const hosts = await prisma.host.findMany({
    where: { id: { in: allIds } },
    include: { calendars: true },
  });
  const callerHost = hosts.find((h) => h.id === caller.id);
  if (!callerHost) return NextResponse.json({ error: "caller not found" }, { status: 404 });
  if (!callerHost.googleRefreshToken) {
    return NextResponse.json({ error: "Connect your Google Calendar first." }, { status: 503 });
  }

  // Attendees without Google credentials surface in `missingGoogle` so the UI can warn. They
  // do NOT contribute to free/busy data — they're left out of perHostSlots entirely and the
  // UI shows them as "calendar unknown" rather than pretending they're free.
  const missingGoogle = hosts.filter((h) => !h.googleRefreshToken && h.id !== caller.id).map((h) => h.id);

  // Per-host availability — engine reads "no buffer, 15-min notice, max-advance=60d" as a
  // generic stub since this isn't a meeting type. Returns the set of slots the host is free at.
  const eligibleHosts = hosts.filter((h) => h.googleRefreshToken);
  const perHostSlots = await Promise.all(
    eligibleHosts.map(async (h) => {
      const busy = await fetchHostBusy(h, { from, to: effectiveTo });
      const slots = computeAvailableSlots({
        host: {
          timezone: h.timezone,
          workingHours: effectiveWorkingHours({}, h, undefined),
        },
        meetingType: {
          durationMinutes,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          minNoticeMinutes: 15,
          // 60-day cap was already enforced on `to`, so the engine doesn't need to clamp again.
          maxAdvanceDays: 60,
        },
        range: { from, to: effectiveTo },
        busy,
      });
      return { hostId: h.id, freeKeys: new Set(slots.map((s) => s.startsAt.getTime())) };
    }),
  );

  // Candidate slots = times the CALLER is free. The caller is the organiser, so a slot is
  // useless if they can't attend. For each candidate we then check which other attendees are
  // free vs. busy so the UI can show "3/4 free · Martijn busy" instead of a binary filter.
  const callerEntry = perHostSlots.find((e) => e.hostId === caller.id);
  if (!callerEntry) {
    return NextResponse.json({ slots: [], durationMinutes, missingGoogle });
  }
  const callerBusy = await fetchHostBusy(callerHost, { from, to: effectiveTo });
  const callerSlots = computeAvailableSlots({
    host: { timezone: callerHost.timezone, workingHours: effectiveWorkingHours({}, callerHost, undefined) },
    meetingType: {
      durationMinutes,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 15,
      maxAdvanceDays: 60,
    },
    range: { from, to: effectiveTo },
    busy: callerBusy,
  });

  const otherAttendeeIds = attendeeIds.filter((id) => id !== caller.id);
  const slots = callerSlots.map((s) => {
    const key = s.startsAt.getTime();
    const freeAttendeeIds: string[] = [];
    const busyAttendeeIds: string[] = [];
    for (const other of otherAttendeeIds) {
      const entry = perHostSlots.find((e) => e.hostId === other);
      if (!entry) continue; // attendee missing Google — already in missingGoogle, skip here
      if (entry.freeKeys.has(key)) freeAttendeeIds.push(other);
      else busyAttendeeIds.push(other);
    }
    return {
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      freeAttendeeIds,
      busyAttendeeIds,
    };
  });

  return NextResponse.json({
    slots,
    durationMinutes,
    missingGoogle,
    totalAttendees: otherAttendeeIds.length,
  });
}
