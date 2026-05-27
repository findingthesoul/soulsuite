import { notFound } from "next/navigation";
import Link from "next/link";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { publicEnv } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { type ProposedSlot, type VoteMap, tallyVotes } from "@/lib/polls";
import { PollDetailClient } from "./client";

export default async function PollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPageContextOrRedirect();

  const poll = await prisma.poll.findUnique({
    where: { id },
    include: { responses: true, project: { select: { name: true } } },
  });
  if (!poll) notFound();
  if (poll.ownerHostId !== ctx.host.id) notFound();

  const slots = poll.proposedSlots as unknown as ProposedSlot[];
  const responses = poll.responses.map((r) => ({
    email: r.inviteeEmail,
    votes: r.votes as unknown as VoteMap,
    inviteUrl: `${publicEnv.NEXT_PUBLIC_APP_URL}/poll/respond/${r.token}`,
    voted: Object.keys((r.votes as unknown as VoteMap) ?? {}).length > 0,
  }));
  const tally = tallyVotes(slots, poll.responses.map((r) => ({ votes: r.votes as unknown as VoteMap })));

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/polls" className="hover:text-foreground">
              Polls
            </Link>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{poll.name}</h1>
            {poll.scope === "PROJECT" && poll.project && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium text-foreground">
                Team: {poll.project.name}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {poll.durationMinutes} min · {poll.inviteeEmails.length} invitees · {poll.status.toLowerCase()}
          </p>
        </header>

        {poll.status === "FINALIZED" && (
          <Card className="border-foreground/30">
            <div className="p-5 space-y-1">
              <p className="text-xs uppercase tracking-wide text-subtle-foreground">Final time</p>
              <p className="text-sm font-medium text-foreground">
                <FinalizedTime slot={poll.finalizedSlot as unknown as ProposedSlot | null} />
              </p>
            </div>
          </Card>
        )}

        <PollDetailClient
          pollId={poll.id}
          status={poll.status}
          slots={slots}
          tally={tally}
          responses={responses}
          notifyMode={poll.notifyMode}
        />
      </div>
    </AppShell>
  );
}

function FinalizedTime({ slot }: { slot: ProposedSlot | null }) {
  if (!slot) return <span>—</span>;
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return <>{`${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)} (UTC)`}</>;
}
