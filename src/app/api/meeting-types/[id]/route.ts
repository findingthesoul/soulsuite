import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";
import { intakeFieldsSchema } from "@/lib/intake";
import { syncIntakeForm } from "@/lib/intake-server";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z
    .number()
    .int()
    .refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z
    .number()
    .int()
    .refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z
    .number()
    .int()
    .refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z
    .number()
    .int()
    .refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  intakeFields: intakeFieldsSchema.default([]),
  isActive: z.boolean(),
  conferencingProvider: z.enum(["GOOGLE_MEET", "ZOOM", "TEAMS", "NONE"]),
  maxInvitees: z.number().int().min(1).max(50).default(1),
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

  if (parsed.data.conferencingProvider === "ZOOM" && !host.zoomRefreshToken) {
    return new NextResponse("Connect Zoom in Settings → Connections before using it.", { status: 400 });
  }
  if (parsed.data.conferencingProvider === "TEAMS") {
    return new NextResponse("Microsoft Teams is not supported yet.", { status: 400 });
  }

  // Validate that any conflict-calendar IDs belong to this host.
  if (parsed.data.conflictCalendarIds.length > 0) {
    const owned = await prisma.calendar.findMany({
      where: { hostId: host.id, id: { in: parsed.data.conflictCalendarIds } },
      select: { id: true },
    });
    if (owned.length !== parsed.data.conflictCalendarIds.length) {
      return new NextResponse("One or more selected calendars don't belong to you.", { status: 400 });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.meetingType.update({
        where: { id },
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description ?? null,
          durationMinutes: parsed.data.durationMinutes,
          bufferBeforeMinutes: parsed.data.bufferBeforeMinutes,
          bufferAfterMinutes: parsed.data.bufferAfterMinutes,
          minNoticeMinutes: parsed.data.minNoticeMinutes,
          maxAdvanceDays: parsed.data.maxAdvanceDays,
          conflictCalendarIds: parsed.data.conflictCalendarIds,
          isActive: parsed.data.isActive,
          conferencingProvider: parsed.data.conferencingProvider,
          maxInvitees: parsed.data.maxInvitees,
        },
      });
      const newFormId = await syncIntakeForm({
        meetingTypeId: id,
        scope: "PERSONAL",
        hostId: host.id,
        fields: parsed.data.intakeFields,
        formName: parsed.data.name,
        existingIntakeFormId: existing.intakeFormId,
        tx,
      });
      if (newFormId !== existing.intakeFormId) {
        await tx.meetingType.update({ where: { id }, data: { intakeFormId: newFormId } });
      }
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
