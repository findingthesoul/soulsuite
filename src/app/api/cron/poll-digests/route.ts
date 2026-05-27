// Daily cron: poll digests + vote reminders.
//
// Triggered by Vercel Cron (configured in vercel.json) once per day. Auth via the
// CRON_SECRET header — Vercel sends it as `Authorization: Bearer <secret>`; we accept the
// raw header too for curl-based smoke testing.
//
// What it does, per OPEN poll:
//   1. If notifyMode = DAILY_DIGEST: send one summary email to the owner about activity in
//      the last 24h. Stamps Poll.lastNotifiedAt so we don't double-fire if the cron runs
//      twice in a window.
//   2. If the earliest proposed slot is within 48 hours AND we haven't sent a reminder yet:
//      ping every invitee who hasn't voted with a vote-reminder email. Stamps
//      Poll.reminderSentAt so this only fires once per poll.
//
// Idempotency: both branches only act when their stamp is older than the threshold, so
// re-running the cron mid-day is safe. The endpoint returns a small JSON summary so the
// Vercel cron dashboard surfaces useful counts.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import {
  appUrl,
  pollDigestTemplate,
  pollVoteReminderTemplate,
  sendEmail,
} from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import type { ProposedSlot } from "@/lib/polls";

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}

async function runCron(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? request.headers.get("x-cron-secret") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  if (auth !== expected && auth !== env.CRON_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fortyEightHrs = 48 * 60 * 60 * 1000;

  // Pull every OPEN poll. The numbers are small (polls are short-lived) so a full scan is
  // fine without pagination.
  const polls = await prisma.poll.findMany({
    where: { status: "OPEN" },
    include: { responses: true, owner: { select: { name: true, email: true } } },
  });

  let digestsSent = 0;
  let remindersSent = 0;
  const logoUrl = await getEmailLogoUrl();

  for (const poll of polls) {
    const slots = poll.proposedSlots as unknown as ProposedSlot[];
    const earliestSlotMs = slots
      .map((s) => new Date(s.startsAt).getTime())
      .reduce((a, b) => Math.min(a, b), Infinity);
    const totalInvitees = poll.inviteeEmails.length;
    const responsesWithVotes = poll.responses.filter(
      (r) => Object.keys((r.votes ?? {}) as Record<string, unknown>).length > 0,
    );
    const totalResponses = responsesWithVotes.length;

    // ── 1. Daily digest ──
    if (poll.notifyMode === "DAILY_DIGEST") {
      const lastFired = poll.lastNotifiedAt;
      const fireDigest =
        !lastFired || lastFired.getTime() < dayAgo.getTime();
      if (fireDigest) {
        // Count votes received since lastFired (or since poll creation). Each response row
        // carries a single votes map — we treat "has any votes" as a discrete signal; the
        // digest doesn't try to track granular updates inside a row.
        const since = lastFired ?? poll.createdAt;
        const newVotesSinceLast = poll.responses.filter(
          (r) =>
            Object.keys((r.votes ?? {}) as Record<string, unknown>).length > 0 &&
            r.updatedAt.getTime() > since.getTime(),
        ).length;

        // Skip the digest if absolutely nothing has happened — no point pinging the owner.
        if (newVotesSinceLast > 0 || totalResponses > 0) {
          const tmpl = pollDigestTemplate({
            ownerName: poll.owner.name,
            pollName: poll.name,
            totalResponses,
            totalInvitees,
            newVotesSinceLast,
            pollUrl: appUrl(`/dashboard/polls/${poll.id}`),
            logoUrl,
          });
          // Await inside the cron — there's no HTTP response to race; the runtime keeps the
          // function alive until the loop finishes naturally.
          const res = await sendEmail({
            to: poll.owner.email,
            subject: tmpl.subject,
            html: tmpl.html,
            text: tmpl.text,
            fromName: "Soul Suite",
          });
          if (res.ok) digestsSent += 1;
          await prisma.poll.update({
            where: { id: poll.id },
            data: { lastNotifiedAt: now },
          });
        }
      }
    }

    // ── 2. Pre-deadline reminder for non-voters ──
    // Fires when the earliest proposed slot is within 48 hours AND no reminder has gone out
    // for this poll yet. Once stamped, never re-fires for this poll.
    if (
      !poll.reminderSentAt &&
      earliestSlotMs !== Infinity &&
      earliestSlotMs - now.getTime() <= fortyEightHrs &&
      earliestSlotMs > now.getTime()
    ) {
      const hoursUntilEarliestSlot = Math.max(
        1,
        Math.round((earliestSlotMs - now.getTime()) / (60 * 60 * 1000)),
      );
      const votedEmails = new Set(responsesWithVotes.map((r) => r.inviteeEmail));
      const nonVoters = poll.responses.filter((r) => !votedEmails.has(r.inviteeEmail));
      let anySent = false;
      for (const r of nonVoters) {
        const tmpl = pollVoteReminderTemplate({
          ownerName: poll.owner.name,
          pollName: poll.name,
          hoursUntilEarliestSlot,
          voteUrl: appUrl(`/poll/respond/${r.token}`),
          recipientEmail: r.inviteeEmail,
          logoUrl,
        });
        const res = await sendEmail({
          to: r.inviteeEmail,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
          fromName: poll.owner.name,
          replyTo: poll.owner.email,
        });
        if (res.ok) {
          remindersSent += 1;
          anySent = true;
        }
      }
      if (anySent || nonVoters.length === 0) {
        // Stamp even when there were zero non-voters so the cron doesn't keep rechecking
        // this poll every day until the slot passes.
        await prisma.poll.update({
          where: { id: poll.id },
          data: { reminderSentAt: now },
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    pollsScanned: polls.length,
    digestsSent,
    remindersSent,
    ranAt: now.toISOString(),
  });
}
