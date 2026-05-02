import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Create a one-off meeting type. Slots are hand-picked instead of derived from the
// availability engine. Personal-scope only for v1 — project one-offs can come later.
const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  conferencingProvider: z.enum(["GOOGLE_MEET", "ZOOM", "TEAMS", "NONE"]).default("GOOGLE_MEET"),
  slots: z
    .array(
      z.object({
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;

  if (data.conferencingProvider === "ZOOM" && !host.zoomRefreshToken) {
    return new NextResponse("Connect Zoom in Settings → Connections before using it.", { status: 400 });
  }
  if (data.conferencingProvider === "TEAMS" && !host.microsoftRefreshToken) {
    return new NextResponse("Connect Microsoft in Settings → Connections before using it.", { status: 400 });
  }

  // Validate every slot has end > start, and dedupe by (startsAt) — uniqueness is enforced at DB.
  const seen = new Set<string>();
  const slotRows: { startsAt: Date; endsAt: Date; durationMinutes: number }[] = [];
  for (const s of data.slots) {
    const startsAt = new Date(s.startsAt);
    const endsAt = new Date(s.endsAt);
    const durationMs = endsAt.getTime() - startsAt.getTime();
    if (durationMs <= 0) {
      return new NextResponse("Each slot must have an end after its start.", { status: 400 });
    }
    const key = startsAt.toISOString();
    if (seen.has(key)) {
      return new NextResponse("Duplicate start time across slots.", { status: 400 });
    }
    seen.add(key);
    slotRows.push({ startsAt, endsAt, durationMinutes: Math.round(durationMs / 60000) });
  }

  // Use the first slot's duration as the meeting type's durationMinutes (used for slug routing
  // and the booking POST sanity check). Slots can have different durations on the row level.
  const durationMinutes = slotRows[0].durationMinutes;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const mt = await tx.meetingType.create({
        data: {
          scope: Scope.PERSONAL,
          hostId: host.id,
          slug: data.slug,
          name: data.name,
          description: data.description ?? null,
          durationMinutes,
          routingMode: RoutingMode.SINGLE,
          assignedHostIds: [host.id],
          conferencingProvider: data.conferencingProvider,
          isOneOff: true,
        },
      });
      await tx.oneOffSlot.createMany({
        data: slotRows.map((s) => ({
          meetingTypeId: mt.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
      });
      return mt;
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${data.slug}" is already taken on your meeting types.`, { status: 409 });
    }
    throw err;
  }
}
