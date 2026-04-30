import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Scope, RoutingMode } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";
import { intakeFieldsSchema } from "@/lib/intake";
import { syncIntakeForm } from "@/lib/intake-server";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z.number().int().refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z.number().int().refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  routingMode: z.enum(["SINGLE", "ROUND_ROBIN"]).default("SINGLE"),
  // SINGLE → exactly 1 host. ROUND_ROBIN → 2 or more.
  assignedHostIds: z.array(z.string().min(1)).min(1),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  intakeFields: intakeFieldsSchema.default([]),
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

  // Routing mode invariants. SINGLE = exactly one host; ROUND_ROBIN = at least two.
  if (data.routingMode === "SINGLE" && data.assignedHostIds.length !== 1) {
    return new NextResponse("Single-host mode needs exactly one assigned host.", { status: 400 });
  }
  if (data.routingMode === "ROUND_ROBIN" && data.assignedHostIds.length < 2) {
    return new NextResponse("Round-robin needs at least two assigned hosts.", { status: 400 });
  }

  // Every assignedHostId must be a ProjectMember of this project.
  const members = await prisma.projectMember.findMany({
    where: { projectId, hostId: { in: data.assignedHostIds } },
    select: { hostId: true },
  });
  if (members.length !== data.assignedHostIds.length) {
    return new NextResponse("All assigned hosts must be project members.", { status: 400 });
  }

  // SINGLE mode: conflict calendars must belong to the (single) assigned host. ROUND_ROBIN
  // doesn't support per-meeting-type conflict overrides since hosts have separate calendars —
  // each host's default applies.
  if (data.routingMode === "SINGLE" && data.conflictCalendarIds.length > 0) {
    const owned = await prisma.calendar.findMany({
      where: { hostId: data.assignedHostIds[0], id: { in: data.conflictCalendarIds } },
      select: { id: true },
    });
    if (owned.length !== data.conflictCalendarIds.length) {
      return new NextResponse("Selected calendars must belong to the assigned host.", { status: 400 });
    }
  }
  if (data.routingMode === "ROUND_ROBIN" && data.conflictCalendarIds.length > 0) {
    return new NextResponse(
      "Round-robin can't use a single conflict-calendar override — each host's defaults apply.",
      { status: 400 },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const mt = await tx.meetingType.create({
        data: {
          scope: Scope.PROJECT,
          projectId,
          slug: data.slug,
          name: data.name,
          description: data.description ?? null,
          durationMinutes: data.durationMinutes,
          routingMode: data.routingMode === "ROUND_ROBIN" ? RoutingMode.ROUND_ROBIN : RoutingMode.SINGLE,
          assignedHostIds: data.assignedHostIds,
          bufferBeforeMinutes: data.bufferBeforeMinutes,
          bufferAfterMinutes: data.bufferAfterMinutes,
          minNoticeMinutes: data.minNoticeMinutes,
          maxAdvanceDays: data.maxAdvanceDays,
          conflictCalendarIds: data.conflictCalendarIds,
        },
      });
      const intakeFormId = await syncIntakeForm({
        meetingTypeId: mt.id,
        scope: "PROJECT",
        projectId,
        fields: data.intakeFields,
        formName: data.name,
        existingIntakeFormId: null,
        tx,
      });
      if (intakeFormId) {
        await tx.meetingType.update({ where: { id: mt.id }, data: { intakeFormId } });
      }
      return mt;
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse(`Slug "${data.slug}" is already taken in this project.`, { status: 409 });
    }
    throw err;
  }
}
