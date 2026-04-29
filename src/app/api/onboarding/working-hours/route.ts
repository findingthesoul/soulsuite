import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const rangeSchema = z
  .object({
    start: z.string().regex(TIME_RE),
    end: z.string().regex(TIME_RE),
  })
  .refine((r) => r.start < r.end, { message: "Start must be before end." });

const dayKey = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const bodySchema = z.object({
  timezone: z.string().min(1),
  workingHours: z.record(dayKey, z.array(rangeSchema)),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }

  // Validate the timezone is a real IANA zone the host's runtime can resolve.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return NextResponse.json({ error: "Unknown timezone" }, { status: 400 });
  }

  await prisma.host.update({
    where: { id: host.id },
    data: { timezone: parsed.data.timezone, workingHours: parsed.data.workingHours },
  });

  return NextResponse.json({ ok: true });
}
