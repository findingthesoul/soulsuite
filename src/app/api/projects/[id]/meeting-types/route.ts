import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z.number().int().refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z.number().int().refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  // Single-host for v1 (brief: round-robin lands in step 10).
  assignedHostIds: z.array(z.string().min(1)).length(1),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;
  const assignedHostId = data.assignedHostIds[0];

  // Brief invariant §"A few invariants worth enforcing in code": every assignedHostId must be
  // a ProjectMember of this project.
  const hostIsMember = await prisma.projectMember.findUnique({
    where: { projectId_hostId: { projectId, hostId: assignedHostId } },
  });
  if (!hostIsMember) {
    return new NextResponse("Assigned host must be a project member.", { status: 400 });
  }

  // Conflict calendars must belong to the assigned host.
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
    const created = await prisma.meetingType.create({
      data: {
        scope: Scope.PROJECT,
        projectId,
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        durationMinutes: data.durationMinutes,
        routingMode: RoutingMode.SINGLE,
        assignedHostIds: [assignedHostId],
        bufferBeforeMinutes: data.bufferBeforeMinutes,
        bufferAfterMinutes: data.bufferAfterMinutes,
        minNoticeMinutes: data.minNoticeMinutes,
        maxAdvanceDays: data.maxAdvanceDays,
        conflictCalendarIds: data.conflictCalendarIds,
      },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${data.slug}" is already taken in this project.`, { status: 409 });
    }
    throw err;
  }
}
