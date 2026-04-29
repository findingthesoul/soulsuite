import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  isActive: z.boolean(),
});

async function findOwnedMeetingType(id: string, hostId: string) {
  const mt = await prisma.meetingType.findUnique({ where: { id } });
  if (!mt) return null;
  // Personal scope only — project meeting types come in step 6 of the build order.
  if (mt.scope !== "PERSONAL" || mt.hostId !== hostId) return null;
  return mt;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const existing = await findOwnedMeetingType(id, host.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const json = await request.json();
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  try {
    await prisma.meetingType.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description ?? null,
        durationMinutes: parsed.data.durationMinutes,
        isActive: parsed.data.isActive,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${parsed.data.slug}" is already taken on your meeting types.`, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const existing = await findOwnedMeetingType(id, host.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Bookings keep the FK reference. We don't cascade-delete bookings — they're historical
  // records and the host wants to see them in the dashboard. Soft-deactivate would be safer
  // long-term, but for v1 a hard delete with the booking FK preserved is fine.
  // (The Booking.meetingTypeId FK has no onDelete, so Prisma will reject if there are bookings.)
  try {
    await prisma.meetingType.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2003") {
      return new NextResponse(
        "This meeting type has bookings — deactivate it instead so existing records stay intact.",
        { status: 409 },
      );
    }
    throw err;
  }
}
