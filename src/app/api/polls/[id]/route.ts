import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { PollStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import type { ProposedSlot } from "@/lib/polls";
import { upsertContactFromBooking } from "@/lib/contacts";
import { resolveRecipientTimezones } from "@/lib/recipient-timezone";
import {
  appUrl,
  pollFinalizedInviteeTemplate,
  sendEmailAfterResponse,
} from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";

const patchSchema = z.union([
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("finalize"),
    slotId: z.string().min(1),
    // Optional: a placeholder MeetingType to anchor the booking onto. For v1, we create an
    // ephemeral PERSONAL meeting type with a unique slug to satisfy the Booking FK.
  }),
  z.object({
    action: z.literal("updateSettings"),
    notifyMode: z.enum(["FINAL_ONLY", "EVERY_VOTE", "DAILY_DIGEST", "NEVER"]),
  }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const poll = await prisma.poll.findUnique({
    where: { id },
    include: { responses: true },
  });
  if (!poll) return new NextResponse("Poll not found", { status: 404 });
  if (poll.ownerHostId !== host.id) return new NextResponse("forbidden", { status: 403 });
  if (poll.status !== "OPEN") {
    return new NextResponse(`Poll is already ${poll.status.toLowerCase()}.`, { status: 409 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const body = parsed.data;

  if (body.action === "cancel") {
    await prisma.poll.update({ where: { id }, data: { status: PollStatus.CANCELLED } });
    return NextResponse.json({ ok: true });
  }

  // Update settings: changes notifyMode without touching status/slots. Same auth (owner +
  // OPEN) — we don't let owners flip notification mode after the poll closes since there's
  // nothing left to notify about.
  if (body.action === "updateSettings") {
    await prisma.poll.update({
      where: { id },
      data: { notifyMode: body.notifyMode },
    });
    return NextResponse.json({ ok: true });
  }

  // Finalize: create a Booking + Google event for the picked slot, then mark poll FINALIZED.
  const slots = poll.proposedSlots as unknown as ProposedSlot[];
  const slot = slots.find((s) => s.id === body.slotId);
  if (!slot) return new NextResponse("Picked slot not in this poll.", { status: 400 });

  const fullHost = await prisma.host.findUnique({
    where: { id: host.id },
    include: { calendars: true },
  });
  if (!fullHost) return new NextResponse("Host not found", { status: 404 });
  const writeTarget = fullHost.calendars.find((c) => c.role === "WRITE_TARGET");
  if (!writeTarget) {
    return new NextResponse("You haven't picked a write-target calendar yet — set one in Settings → Calendars.", {
      status: 409,
    });
  }
  if (!fullHost.googleRefreshToken) {
    return new NextResponse("Reconnect Google before finalizing the poll.", { status: 503 });
  }

  // Polls aren't tied to a specific MeetingType — they have their own duration + name. We
  // create an ephemeral PERSONAL meeting type as the "anchor" so Booking's FK is satisfied.
  // The MT is marked inactive so it doesn't appear in /dashboard/meeting-types or accept fresh
  // public bookings — it's just a record-keeping shell.
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  const pollMtSlug = `poll-${poll.id.slice(0, 8)}-${Date.now().toString(36)}`;

  const inviteeEmails = poll.inviteeEmails;
  const inviteeNamesByEmail: Record<string, string> = {};
  for (const r of poll.responses) inviteeNamesByEmail[r.inviteeEmail] = r.inviteeEmail; // fallback to email

  // Build the Google event first; if Google fails we abort without leaving stale rows.
  let googleEventId: string | null = null;
  try {
    const cal = calendarFor(fullHost.googleRefreshToken);
    const ev = await cal.events.insert({
      calendarId: writeTarget.googleCalendarId,
      conferenceDataVersion: 1,
      sendUpdates: "none",
      requestBody: {
        summary: `${poll.name}`,
        description: `Group meeting finalized from a Soul Suite poll.\nInvitees: ${inviteeEmails.join(", ")}`,
        start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        attendees: [
          { email: fullHost.email, displayName: fullHost.name, organizer: true },
          ...inviteeEmails.map((email) => ({ email })),
        ],
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    googleEventId = ev.data.id ?? null;
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
    }
    return new NextResponse("Couldn't create the calendar event. Please try again.", { status: 502 });
  }

  // Now persist: ephemeral MT + Booking + finalized Poll, in one transaction.
  const requestId = `pl-${createHash("sha256")
    .update(`${poll.id}:${slot.id}:${startsAt.toISOString()}`)
    .digest("hex")
    .slice(0, 32)}`;

  // We use the poll owner's email as the invitee on the booking row so the row is well-formed.
  // Multi-attendee rendering on the booking page comes later.
  await prisma.$transaction(async (tx) => {
    // Project-scoped polls produce a project-scoped ephemeral MeetingType + a Booking with
    // projectId set, so the team-bookings filter picks them up. Routing stays SINGLE for v1
    // (round-robin / collective on poll finalize is a future iteration).
    const isProjectPoll = poll.scope === "PROJECT" && poll.projectId !== null;
    const mt = await tx.meetingType.create({
      data: {
        scope: isProjectPoll ? "PROJECT" : "PERSONAL",
        hostId: isProjectPoll ? null : host.id,
        projectId: isProjectPoll ? poll.projectId : null,
        slug: pollMtSlug,
        name: poll.name,
        durationMinutes: poll.durationMinutes,
        routingMode: "SINGLE",
        assignedHostIds: [host.id],
        isActive: false,
      },
    });
    const booking = await tx.booking.create({
      data: {
        meetingTypeId: mt.id,
        hostId: host.id,
        projectId: isProjectPoll ? poll.projectId : null,
        inviteeEmail: inviteeEmails[0],
        inviteeName: inviteeNamesByEmail[inviteeEmails[0]] ?? inviteeEmails[0],
        startsAt,
        endsAt,
        requestId,
        status: "CONFIRMED",
        googleEventId,
        inviteeAnswers: {
          pollAttendees: inviteeEmails,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.poll.update({
      where: { id: poll.id },
      data: {
        status: PollStatus.FINALIZED,
        finalizedSlot: slot as unknown as Prisma.InputJsonValue,
        finalizedBookingId: booking.id,
      },
    });
  });

  // Auto-build the workspace contact directory from poll attendees. Wrapped so contact
  // failures never fail the finalization — the booking + Google event are already persisted.
  const wsId =
    poll.scope === "PROJECT" && poll.projectId
      ? (await prisma.project.findUnique({
          where: { id: poll.projectId },
          select: { workspaceId: true },
        }))?.workspaceId ?? null
      : (await prisma.workspaceMember.findFirst({
          where: { hostId: host.id },
          select: { workspaceId: true },
        }))?.workspaceId ?? null;
  try {
    if (wsId) {
      for (const email of inviteeEmails) {
        await upsertContactFromBooking({
          workspaceId: wsId,
          email,
          name: inviteeNamesByEmail[email] ?? null,
          timeZone: null,
        });
      }
    }
  } catch (err) {
    console.error("[poll] contact upsert failed", err);
  }

  // Notify every invitee that the slot is set. The Google event Sjoerd just inserted carries
  // them as attendees, so they'll also get Google's native invite — this email is the
  // Soul-Suite branded heads-up that sets expectations and references the poll name.
  const logoUrl = await getEmailLogoUrl();
  const pollDetailUrl = appUrl(`/dashboard/polls/${poll.id}`);
  const inviteeTzMap = await resolveRecipientTimezones(inviteeEmails, wsId);
  sendEmailAfterResponse(
    inviteeEmails.map((email) => {
      const tmpl = pollFinalizedInviteeTemplate({
        ownerName: fullHost.name,
        pollName: poll.name,
        startsAtIso: startsAt.toISOString(),
        endsAtIso: endsAt.toISOString(),
        inviteeEmail: email,
        pollDetailUrl,
        logoUrl,
        timezone: inviteeTzMap.get(email.toLowerCase()) ?? fullHost.timezone,
      });
      return {
        to: email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        fromName: fullHost.name,
        replyTo: fullHost.email,
      };
    }),
  );

  return NextResponse.json({ ok: true });
}
