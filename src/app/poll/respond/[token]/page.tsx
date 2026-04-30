import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CenterShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { type ProposedSlot, type VoteMap } from "@/lib/polls";
import { VotingForm } from "./form";

export default async function PollVoteLanding({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const response = await prisma.pollResponse.findUnique({
    where: { token },
    include: { poll: { include: { owner: true } } },
  });
  if (!response) notFound();

  const { poll } = response;

  if (poll.status === "CANCELLED") {
    return (
      <CenterShell>
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Poll cancelled</h1>
          <p className="text-sm text-muted-foreground">
            {poll.owner.name} cancelled this poll. No vote needed.
          </p>
        </div>
      </CenterShell>
    );
  }
  if (poll.status === "FINALIZED") {
    return (
      <CenterShell>
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Time picked</h1>
          <p className="text-sm text-muted-foreground">
            {poll.owner.name} finalized a time for this poll. Check your calendar invite.
          </p>
        </div>
      </CenterShell>
    );
  }

  const slots = poll.proposedSlots as unknown as ProposedSlot[];
  const initialVotes = (response.votes as unknown as VoteMap | null) ?? {};

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-12 md:px-6 md:py-16">
        <Card>
          <CardHeader>
            <CardTitle>{poll.name}</CardTitle>
            <CardDescription>
              {poll.owner.name} is proposing a {poll.durationMinutes}-minute meeting. Pick what works for you —
              you can update your answers later with the same link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VotingForm token={token} slots={slots} initialVotes={initialVotes} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
