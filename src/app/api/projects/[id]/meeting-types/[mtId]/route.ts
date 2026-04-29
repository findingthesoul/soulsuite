import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z.number().int().refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z.number().int().refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  assignedHostIds: z.array(z.string().min(1)).length(1),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  isActive: z.boolean(),
});

async function authorize(host: { id: string }, projectId: string, mtId: string) {
  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) return { ok: false as const, status: 403 };
  const mt = await prisma.meetingType.findUnique({ where: { id: mtId } });
  if (!mt || mt.scope !== "PROJECT" || mt.projectId !== projectId) {
    return { ok: false as const, status: 404 };
  }
  return { ok: true as const, mt };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mtId: string }> },
) {
  const { id: projectId, mtId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const auth = await authorize(host, projectId, mtId);
  if (!auth.ok) return new NextResponse(auth.status === 403 ? "forbidden" : "not found", { status: auth.status });

  const json = await request.json();
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;
  const assignedHostId = data.assignedHostIds[0];

  // Same invariants as POST.
  const isMember = await prisma.projectMember.findUnique({
    where: { projectId_hostId: { projectId, hostId: assignedHostId } },
  });
  if (!isMember) {
    return new NextResponse("Assigned host must be a project member.", { status: 400 });
  }
  if (data.conflictCalendarIds.length > 0) {
    const owned = await prisma.calendar.findMany({
      where: { hostId: assignedHostId, id: { in: data.conflictCalendarIds } },
      select: { id: true },
    });
    if (owned.length !== data.conflictCalendarIds.length) {
      return new NextResponse("Selected calendars must belong to the assigned host.", { status: 400 });
    }
  }

  try {
    await prisma.meetingType.update({
      where: { id: mtId },
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        durationMinutes: data.durationMinutes,
        bufferBeforeMinutes: data.bufferBeforeMinutes,
        bufferAfterMinutes: data.bufferAfterMinutes,
        minNoticeMinutes: data.minNoticeMinutes,
        maxAdvanceDays: data.maxAdvanceDays,
        assignedHostIds: [assignedHostId],
        conflictCalendarIds: data.conflictCalendarIds,
        isActive: data.isActive,
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${data.slug}" is already taken in this project.`, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; mtId: string }> },
) {
  const { id: projectId, mtId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const auth = await authorize(host, projectId, mtId);
  if (!auth.ok) return new NextResponse(auth.status === 403 ? "forbidden" : "not found", { status: auth.status });

  try {
    await prisma.meetingType.delete({ where: { id: mtId } });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2003") {
      return new NextResponse(
        "This meeting type has bookings — deactivate it instead so existing records stay intact.",
        { status: 409 },
      );
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
