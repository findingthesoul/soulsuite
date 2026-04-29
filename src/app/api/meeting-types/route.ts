import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
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

  // Slug uniqueness within this host's personal meeting types is enforced by the DB unique
  // index (hostId, slug). Catch the conflict and return a clean error.
  try {
    const created = await prisma.meetingType.create({
      data: {
        scope: Scope.PERSONAL,
        hostId: host.id,
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        durationMinutes: data.durationMinutes,
        routingMode: RoutingMode.SINGLE,
        assignedHostIds: [host.id],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        // Step 2 of build order: no notice / no advance limits yet. Schema defaults to sensible
        // values (60 min notice, 60 day advance) which keeps the engine well-behaved.
      },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return new NextResponse(`Slug "${data.slug}" is already taken on your meeting types.`, { status: 409 });
    }
    throw err;
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}
