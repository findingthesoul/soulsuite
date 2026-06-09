// GET /api/team-meetings/slots?attendeeIds=A,B,C&durationMinutes=30&from=ISO&to=ISO
//
// Returns mutual availability for an ad-hoc set of teammates over the requested range. Powers
// the slot picker on /dashboard/team-meeting — the caller picks teammates and a duration, this
// endpoint tells them which times work for everyone.
//
// Algorithm: compute each attendee's own available slots using the same engine as the public
// booking flow (working hours + buffers + freebusy), then intersect by exact (startsAt, endsAt)
// match. Slots are 15-minute-grid aligned so the intersection is meaningful — we don't try to
// find arbitrary mutual gaps, just slots everyone shares.
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

  // Skip hosts without Google credentials — without freebusy we can't honestly say they're free.
  // Returning empty in that case is the safest default (better than pretending they're always
  // available and double-booking them). Surface the gap in the response so the UI can explain.
  const noGoogle = hosts.filter((h) => !h.googleRefreshToken).map((h) => h.id);
  if (noGoogle.length > 0) {
    return NextResponse.json({
      slots: [],
      durationMinutes,
      missingGoogle: noGoogle,
    });
  }

  // Per-host availability computation. No meeting type — pass an empty stub object so the
  // engine reads "no buffer, no min-notice, max-advance = the requested range" semantics. We
  // do pass a min-notice of 15 minutes so back-to-back-with-now bookings aren't offered.
  const perHostSlots = await Promise.all(
    hosts.map(async (h) => {
      const busy = await fetchHostBusy(h, { from, to: effectiveTo });
      return computeAvailableSlots({
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
    }),
  );

  // Intersect across all attendees. We key by startsAt (slots are duration-locked so endsAt is
  // implied) — every host's slot list comes from the same engine on the same grid, so equality
  // by startsAt is exact, not best-effort.
  let mutual = perHostSlots[0] ?? [];
  for (let i = 1; i < perHostSlots.length; i++) {
    const keys = new Set(perHostSlots[i].map((s) => s.startsAt.getTime()));
    mutual = mutual.filter((s) => keys.has(s.startsAt.getTime()));
    if (mutual.length === 0) break;
  }

  return NextResponse.json({
    slots: mutual.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
    durationMinutes,
  });
}
