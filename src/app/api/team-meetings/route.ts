// POST /api/team-meetings
//
// Quick internal meeting creation. Distinct from /api/host-bookings: that one runs every booking
// through the MT scaffolding (intake, idempotency, payment, finalize). This one is purely a
// Google Calendar event between teammates — no MT, no Booking row, no email confirmations from
// Soul Suite (Google sends the invites). Useful for the "let me grab 30 min with the team"
// case that doesn't deserve a meeting type.
//
// Auth: signed-in host. Attendees must all share at least one workspace with the caller.

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { bustFreebusyCacheForHost } from "@/lib/availability/freebusy";

const ALLOWED_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

const bodySchema = z.object({
  attendeeIds: z.array(z.string().min(1)).min(1).max(20),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().refine((n) => (ALLOWED_DURATIONS as readonly number[]).includes(n), {
    message: "durationMinutes must be 15/30/45/60/90/120",
  }),
  subject: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional().nullable(),
  // Conferencing: GOOGLE_MEET creates a Meet link via conferenceData. NONE skips it (in-person
  // or shared room described in `location`). The workspace-shared room options re-use the
  // workspace's stored URLs and put them in the event's `location` field.
  conferencing: z.enum(["GOOGLE_MEET", "WORKSPACE_ZOOM_ROOM", "WORKSPACE_TEAMS_ROOM", "NONE"]),
  // Free-text location, only used when conferencing=NONE. Empty string means "no location".
  location: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new NextResponse(`${issue?.path?.join(".") ?? "body"}: ${issue?.message ?? "invalid"}`, {
      status: 400,
    });
  }
  const body = parsed.data;

  const startsAt = new Date(body.startsAt);
  if (startsAt.getTime() <= Date.now()) {
    return new NextResponse("Pick a time in the future.", { status: 400 });
  }
  const endsAt = new Date(startsAt.getTime() + body.durationMinutes * 60_000);

  // Include the caller in the attendee list (deduped) — they're the organiser AND an attendee.
  const allIds = Array.from(new Set([caller.id, ...body.attendeeIds]));

  // Workspace gate. Mirrors the slots endpoint check so the two stay in sync.
  const callerMemberships = await prisma.workspaceMember.findMany({
    where: { hostId: caller.id },
    select: { workspaceId: true },
  });
  const callerWorkspaceIds = callerMemberships.map((m) => m.workspaceId);
  if (callerWorkspaceIds.length === 0) {
    return new NextResponse("You're not in a workspace.", { status: 403 });
  }
  const memberships = await prisma.workspaceMember.findMany({
    where: { hostId: { in: allIds }, workspaceId: { in: callerWorkspaceIds } },
    select: { hostId: true },
  });
  const sharedHostIds = new Set(memberships.map((m) => m.hostId));
  for (const id of body.attendeeIds) {
    if (!sharedHostIds.has(id)) {
      return new NextResponse("One or more attendees aren't in your workspace.", { status: 403 });
    }
  }

  const hosts = await prisma.host.findMany({
    where: { id: { in: allIds } },
    include: { calendars: true },
  });
  const callerHost = hosts.find((h) => h.id === caller.id);
  if (!callerHost) return new NextResponse("Host not found.", { status: 404 });
  if (!callerHost.googleRefreshToken) {
    return new NextResponse(
      "Your Google Calendar isn't connected. Reconnect under Settings → Calendars.",
      { status: 503 },
    );
  }
  const writeTarget = callerHost.calendars.find((c) => c.role === "WRITE_TARGET");
  if (!writeTarget) {
    return new NextResponse("You don't have a write-target calendar selected.", { status: 400 });
  }

  // Resolve the conferencing target. For shared-room flavours we look up the workspace URL
  // off the caller's primary workspace — same one that powers the workspace-room MTs. If it's
  // unset, fail cleanly so the caller picks a different conferencing option.
  let meetUrl: string | null = null;
  let useGoogleMeet = false;
  let conferencingLabel: string | null = null;
  if (body.conferencing === "GOOGLE_MEET") {
    useGoogleMeet = true;
  } else if (body.conferencing === "WORKSPACE_ZOOM_ROOM" || body.conferencing === "WORKSPACE_TEAMS_ROOM") {
    const workspace = await prisma.workspace.findFirst({
      where: { id: { in: callerWorkspaceIds } },
      select: { sharedZoomRoomUrl: true, sharedTeamsRoomUrl: true },
    });
    const url =
      body.conferencing === "WORKSPACE_TEAMS_ROOM"
        ? workspace?.sharedTeamsRoomUrl
        : workspace?.sharedZoomRoomUrl;
    if (!url) {
      const platform = body.conferencing === "WORKSPACE_TEAMS_ROOM" ? "Teams" : "Zoom";
      return new NextResponse(
        `The workspace's shared ${platform} room URL isn't set — ask an admin to add it in Settings → Workspace.`,
        { status: 400 },
      );
    }
    meetUrl = url;
    conferencingLabel =
      body.conferencing === "WORKSPACE_TEAMS_ROOM" ? "Workspace Teams room" : "Workspace Zoom room";
  }

  const attendees = hosts.map((h) => ({
    email: h.email,
    displayName: h.name,
    organizer: h.id === caller.id,
  }));

  const cal = calendarFor(callerHost.googleRefreshToken);
  let eventId: string | null = null;
  try {
    const description =
      (body.note ? `${body.note}\n\n` : "") +
      `Internal team meeting created via Soul Suite.\nAttendees: ${attendees.map((a) => a.email).join(", ")}` +
      (meetUrl ? `\n${conferencingLabel ?? "Join"}: ${meetUrl}` : "");
    const location =
      meetUrl ??
      (body.conferencing === "NONE" && body.location ? body.location : undefined);
    const ev = await cal.events.insert({
      calendarId: writeTarget.googleCalendarId,
      conferenceDataVersion: useGoogleMeet ? 1 : 0,
      // Let Google email the invites — these are internal meetings, no Soul-Suite-branded
      // confirmation flow involved. Mirrors what a hand-rolled "create event with attendees"
      // in Google Calendar would do.
      sendUpdates: "all",
      requestBody: {
        summary: body.subject,
        description,
        location: location ?? undefined,
        start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        attendees,
        conferenceData: useGoogleMeet
          ? {
              createRequest: {
                requestId: randomUUID(),
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            }
          : undefined,
      },
    });
    eventId = ev.data.id ?? null;
    if (useGoogleMeet) meetUrl = ev.data.hangoutLink ?? meetUrl;
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host
        .update({ where: { id: caller.id }, data: { googleRefreshToken: null } })
        .catch(() => undefined);
      return new NextResponse(
        "Your Google connection expired — reconnect under Settings → Calendars and try again.",
        { status: 503 },
      );
    }
    console.error("[team-meeting] event create failed", err);
    return new NextResponse(
      "Couldn't create the calendar event. Try again or check your Google connection.",
      { status: 502 },
    );
  }

  // Bust freebusy cache for everyone whose calendar this event hit so the next slot lookup
  // sees them as busy. Without this the picker could happily offer the slot a second time.
  for (const id of allIds) bustFreebusyCacheForHost(id);

  return NextResponse.json({
    ok: true,
    eventId,
    meetUrl,
  });
}
