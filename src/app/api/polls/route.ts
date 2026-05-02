import { NextResponse, type NextRequest } from "next/server";
import { Scope, PollStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPollSchema, newResponseToken, type ProposedSlot } from "@/lib/polls";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { sendEmail, pollInviteTemplate, appUrl } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";

// Polls support PERSONAL (default — owned by the host) and PROJECT (owned by a team; requires
// LEAD role on the chosen project). Project polls behave like personal polls but are flagged
// for the team-bookings filter; round-robin / collective routing on poll finalize is left to a
// future iteration.
export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json();
  const parsed = createPollSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;

  // Sanity: each slot's duration must match the meeting duration. Prevents picker bugs from
  // creating polls with mismatched slots.
  const expectedMs = data.durationMinutes * 60_000;
  for (const slot of data.proposedSlots) {
    const ms = new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime();
    if (ms !== expectedMs) {
      return new NextResponse(`Slot ${slot.startsAt} doesn't match the chosen duration.`, {
        status: 400,
      });
    }
  }
  // De-dupe slot IDs (defensive against client bugs).
  const seenIds = new Set<string>();
  for (const s of data.proposedSlots) {
    if (seenIds.has(s.id)) {
      return new NextResponse("Duplicate slot id in proposed slots.", { status: 400 });
    }
    seenIds.add(s.id);
  }

  // Project polls: verify the caller has LEAD role on the target project before persisting.
  if (data.scope === "PROJECT") {
    const membership = await getProjectMembership(host, data.projectId!);
    if (!membership || !canManageProject(membership.role)) {
      return new NextResponse("You need to be a project lead to create a team poll.", {
        status: 403,
      });
    }
  }

  const dedupedEmails = [...new Set(data.inviteeEmails.map((e) => e.toLowerCase()))];

  // Pre-generate tokens so we can both insert PollResponse rows AND send invite emails using
  // the same tokens, without an extra query after the transaction.
  const responses = dedupedEmails.map((email) => ({ email, token: newResponseToken() }));

  const created = await prisma.$transaction(async (tx) => {
    const isProject = data.scope === "PROJECT";
    const poll = await tx.poll.create({
      data: {
        scope: isProject ? Scope.PROJECT : Scope.PERSONAL,
        // PERSONAL polls anchor on the host; PROJECT polls anchor on the project. The owner
        // is always the human who created it (used for "my polls" listing + finalize perms).
        hostId: isProject ? null : host.id,
        projectId: isProject ? data.projectId! : null,
        ownerHostId: host.id,
        name: data.name,
        durationMinutes: data.durationMinutes,
        proposedSlots: data.proposedSlots as unknown as Prisma.InputJsonValue,
        inviteeEmails: dedupedEmails,
        status: PollStatus.OPEN,
      },
    });
    await tx.pollResponse.createMany({
      data: responses.map((r) => ({
        pollId: poll.id,
        inviteeEmail: r.email,
        votes: {} as unknown as Prisma.InputJsonValue,
        token: r.token,
      })),
    });
    return poll;
  });

  // Fire-and-forget invite emails — one per invitee, each with their own magic link.
  const logoUrl = await getEmailLogoUrl();
  for (const r of responses) {
    const tmpl = pollInviteTemplate({
      ownerName: host.name,
      pollName: data.name,
      durationMinutes: data.durationMinutes,
      voteUrl: appUrl(`/poll/respond/${r.token}`),
      recipientEmail: r.email,
      logoUrl,
    });
    void sendEmail({
      to: r.email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: host.name,
      replyTo: host.email,
    });
  }

  return NextResponse.json({ ok: true, id: created.id });
}

// Type re-export so callers can use it without re-importing from polls.ts. Helps avoid repeats.
export type { ProposedSlot };
