import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { voteSchema, type ProposedSlot } from "@/lib/polls";

// Public — auth is the unguessable token. Idempotent: replaces the votes map each call.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const response = await prisma.pollResponse.findUnique({
    where: { token },
    include: { poll: true },
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

  await prisma.pollResponse.update({
    where: { token },
    data: { votes: parsed.data as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true });
}
