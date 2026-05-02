import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { BUFFER_MINUTES, MIN_NOTICE_MINUTES, MAX_ADVANCE_DAYS } from "@/lib/scheduling-rules";
import { intakeFieldsSchema } from "@/lib/intake";
import { syncIntakeForm } from "@/lib/intake-server";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const rangeSchema = z
  .object({ start: z.string().regex(TIME_RE), end: z.string().regex(TIME_RE) })
  .refine((r) => r.start < r.end, { message: "Start must be before end." });
const dayKey = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const workingHoursSchema = z.record(dayKey, z.array(rangeSchema));

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120].includes(v)),
  bufferBeforeMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  bufferAfterMinutes: z.number().int().refine((v) => (BUFFER_MINUTES as readonly number[]).includes(v)),
  minNoticeMinutes: z.number().int().refine((v) => (MIN_NOTICE_MINUTES as readonly number[]).includes(v)),
  maxAdvanceDays: z.number().int().refine((v) => (MAX_ADVANCE_DAYS as readonly number[]).includes(v)),
  routingMode: z.enum(["SINGLE", "ROUND_ROBIN", "COLLECTIVE"]).default("SINGLE"),
  assignedHostIds: z.array(z.string().min(1)).min(1),
  conflictCalendarIds: z.array(z.string().min(1)).default([]),
  intakeFields: intakeFieldsSchema.default([]),
  isActive: z.boolean(),
  conferencingProvider: z.enum(["GOOGLE_MEET", "ZOOM", "TEAMS", "NONE"]),
  maxInvitees: z.number().int().min(1).max(50).default(1),
  workingHoursOverride: workingHoursSchema.nullable().optional(),
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

  // Same invariants as POST.
  if (data.routingMode === "SINGLE" && data.assignedHostIds.length !== 1) {
    return new NextResponse("Single-host mode needs exactly one assigned host.", { status: 400 });
  }
  if (data.routingMode === "ROUND_ROBIN" && data.assignedHostIds.length < 2) {
    return new NextResponse("Round-robin needs at least two assigned hosts.", { status: 400 });
  }
  if (data.routingMode === "COLLECTIVE" && data.assignedHostIds.length < 2) {
    return new NextResponse("Collective needs at least two assigned hosts.", { status: 400 });
  }
  if (data.maxInvitees > 1 && data.routingMode !== "SINGLE") {
    return new NextResponse("Group meetings (maxInvitees > 1) only work with single-host routing.", { status: 400 });
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId, hostId: { in: data.assignedHostIds } },
    select: { hostId: true },
  });
  if (members.length !== data.assignedHostIds.length) {
    return new NextResponse("All assigned hosts must be project members.", { status: 400 });
  }

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
  if (data.routingMode === "COLLECTIVE" && data.conflictCalendarIds.length > 0) {
    return new NextResponse(
      "Collective can't use a single conflict-calendar override — each host's defaults apply.",
      { status: 400 },
    );
  }

  if (data.conferencingProvider === "TEAMS") {
    return new NextResponse("Microsoft Teams is not supported yet.", { status: 400 });
  }
  if (data.conferencingProvider === "ZOOM") {
    const hosts = await prisma.host.findMany({
      where: { id: { in: data.assignedHostIds } },
      select: { id: true, name: true, zoomRefreshToken: true },
    });
    const missing = hosts.filter((h) => !h.zoomRefreshToken);
    if (missing.length > 0) {
      return new NextResponse(
        `These hosts haven't connected Zoom: ${missing.map((h) => h.name).join(", ")}.`,
        { status: 400 },
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.meetingType.update({
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
          routingMode: data.routingMode,
          assignedHostIds: data.assignedHostIds,
          conflictCalendarIds: data.conflictCalendarIds,
          isActive: data.isActive,
          conferencingProvider: data.conferencingProvider,
          maxInvitees: data.maxInvitees,
          workingHoursOverride: data.workingHoursOverride ?? null,
        },
      });
      const newFormId = await syncIntakeForm({
        meetingTypeId: mtId,
        scope: "PROJECT",
        projectId,
        fields: data.intakeFields,
        formName: data.name,
        existingIntakeFormId: auth.mt.intakeFormId,
        tx,
      });
      if (newFormId !== auth.mt.intakeFormId) {
        await tx.meetingType.update({ where: { id: mtId }, data: { intakeFormId: newFormId } });
      }
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
