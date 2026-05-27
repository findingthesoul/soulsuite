import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { voteSchema, type ProposedSlot } from "@/lib/polls";
import {
  appUrl,
  pollAllVotedTemplate,
  pollVoteUpdateTemplate,
  sendEmailAfterResponse,
} from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";

// Public — auth is the unguessable token. Idempotent: replaces the votes map each call.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const response = await prisma.pollResponse.findUnique({
    where: { token },
    include: { poll: { include: { owner: true } } },
  });
  if (!response) return new NextResponse("Vote link not found.", { status: 404 });
  if (response.poll.status !== "OPEN") {
    return new NextResponse(`Voting closed — poll is ${response.poll.status.toLowerCase()}.`, { status: 409 });
  }

  const json = await request.json().catch(() => null);
  const parsed = voteSchema.safeParse(json);
  if (!parsed.success) return new NextResponse("invalid body", { status: 400 });

  // Reject votes for slots that don't belong to this poll.
  const slots = response.poll.proposedSlots as unknown as ProposedSlot[];
  const validIds = new Set(slots.map((s) => s.id));
  for (const slotId of Object.keys(parsed.data)) {
    if (!validIds.has(slotId)) {
      return new NextResponse(`Unknown slot in vote: ${slotId}`, { status: 400 });
    }
  }

  // Detect "this is the first vote on this response row" before we overwrite — used by the
  // FINAL_ONLY check below (we only consider "all voted" when the count of responses with at
  // least one vote matches inviteeEmails.length).
  const previousVoteCount = Object.keys(
    (response.votes ?? {}) as Record<string, unknown>,
  ).length;

  await prisma.pollResponse.update({
    where: { token },
    data: { votes: parsed.data as unknown as Prisma.InputJsonValue },
  });

  // ── Owner notifications ──
  // Best-effort: failures here never break the public vote API. Queued via after() so the
  // response returns fast.
  const poll = response.poll;
  if (poll.notifyMode !== "NEVER") {
    const pollUrl = appUrl(`/dashboard/polls/${poll.id}`);
    const ownerEmail = poll.owner.email;
    const ownerName = poll.owner.name;
    const totalInvitees = poll.inviteeEmails.length;

    // Count distinct invitees that now have at least one vote recorded. We do this AFTER the
    // update so the new vote is included. PollResponse.votes is JSON; checking jsonb_typeof
    // would be cheap but Prisma can't easily express it, so fetch + filter in JS.
    const allResponses = await prisma.pollResponse.findMany({
      where: { pollId: poll.id },
      select: { votes: true, inviteeEmail: true },
    });
    const responsesWithVotes = allResponses.filter(
      (r) => Object.keys((r.votes ?? {}) as Record<string, unknown>).length > 0,
    );
    const votedCount = responsesWithVotes.length;

    // Per-vote notification: only when the owner asked for it AND this is a meaningful vote
    // (not an empty submission). Throttle: never more than one per response row state-change,
    // bumping lastNotifiedAt to "now" so a duplicate POST inside a few seconds doesn't double.
    const isNewVote = previousVoteCount === 0 && Object.keys(parsed.data).length > 0;
    if (poll.notifyMode === "EVERY_VOTE" && Object.keys(parsed.data).length > 0) {
      const logoUrl = await getEmailLogoUrl();
      const tmpl = pollVoteUpdateTemplate({
        ownerName,
        pollName: poll.name,
        responderEmail: response.inviteeEmail,
        totalResponses: votedCount,
        totalInvitees,
        pollUrl,
        logoUrl,
      });
      sendEmailAfterResponse({
        to: ownerEmail,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        fromName: "Soul Suite",
      });
      await prisma.poll.update({
        where: { id: poll.id },
        data: { lastNotifiedAt: new Date() },
      });
    }

    // All-voted notification: fires once across the poll's lifetime, regardless of notifyMode
    // (so even FINAL_ONLY hosts get this single confirmation). Guarded by allVotedNotifiedAt
    // so re-votes after the threshold don't re-fire.
    if (
      isNewVote &&
      !poll.allVotedNotifiedAt &&
      votedCount >= totalInvitees &&
      totalInvitees > 0
    ) {
      const logoUrl = await getEmailLogoUrl();
      const tmpl = pollAllVotedTemplate({
        ownerName,
        pollName: poll.name,
        totalInvitees,
        pollUrl,
        logoUrl,
      });
      sendEmailAfterResponse({
        to: ownerEmail,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        fromName: "Soul Suite",
      });
      await prisma.poll.update({
        where: { id: poll.id },
        data: { allVotedNotifiedAt: new Date() },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
