import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CalendarRole } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  calendars: z
    .array(
      z.object({
        googleCalendarId: z.string().min(1),
        role: z.enum(["CONFLICT_CHECK", "WRITE_TARGET"]),
        summary: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .refine((arr) => arr.filter((c) => c.role === "WRITE_TARGET").length === 1, {
      message: "Exactly one calendar must be marked as the write target.",
    }),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }

  // Replace the host's full calendar set with the new selection. Atomic via transaction
  // so we never leave the host with zero calendars mid-write.
  await prisma.$transaction([
    prisma.calendar.deleteMany({ where: { hostId: host.id } }),
    prisma.calendar.createMany({
      data: parsed.data.calendars.map((c) => ({
        hostId: host.id,
        googleCalendarId: c.googleCalendarId,
        summary: c.summary ?? null,
        role: c.role as CalendarRole,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true });
}
