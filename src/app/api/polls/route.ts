import { NextResponse, type NextRequest } from "next/server";
import { Scope, PollStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPollSchema, newResponseToken, type ProposedSlot } from "@/lib/polls";

// Personal polls only for v1 (scope=PERSONAL). Project polls land later — schema already
// supports them, just not surfaced in the UI yet.
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

  const dedupedEmails = [...new Set(data.inviteeEmails.map((e) => e.toLowerCase()))];

  const created = await prisma.$transaction(async (tx) => {
    const poll = await tx.poll.create({
      data: {
        scope: Scope.PERSONAL,
        hostId: host.id,
        ownerHostId: host.id,
        name: data.name,
        durationMinutes: data.durationMinutes,
        proposedSlots: data.proposedSlots as unknown as Prisma.InputJsonValue,
        inviteeEmails: dedupedEmails,
        status: PollStatus.OPEN,
      },
    });
    // One PollResponse per invitee, with an empty vote map and a unique token.
    await tx.pollResponse.createMany({
      data: dedupedEmails.map((email) => ({
        pollId: poll.id,
        inviteeEmail: email,
        votes: {} as unknown as Prisma.InputJsonValue,
        token: newResponseToken(),
      })),
    });
    return poll;
  });

  return NextResponse.json({ ok: true, id: created.id });
}

// Type re-export so callers can use it without re-importing from polls.ts. Helps avoid repeats.
export type { ProposedSlot };
