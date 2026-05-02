import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Per-team (per-project) working-hours override on a ProjectMember row. Mirrors the per-MT
// override shape exactly. Null/empty resets to "use host default".

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const rangeSchema = z
  .object({ start: z.string().regex(TIME_RE), end: z.string().regex(TIME_RE) })
  .refine((r) => r.start < r.end, { message: "Start must be before end." });
const dayKey = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const workingHoursSchema = z.record(dayKey, z.array(rangeSchema));

const patchSchema = z.object({
  workingHoursOverride: workingHoursSchema.nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id: projectId, memberId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Caller must be a member of this project.
  const callerMembership = await getProjectMembership(host, projectId);
  if (!callerMembership) return new NextResponse("forbidden", { status: 403 });

  const target = await prisma.projectMember.findUnique({ where: { id: memberId } });
  if (!target || target.projectId !== projectId) {
    return new NextResponse("not found", { status: 404 });
  }

  // Lead can edit anyone's; non-lead can only edit themselves.
  const isSelf = target.hostId === host.id;
  if (!isSelf && !canManageProject(callerMembership.role)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const json = await request.json();
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const next = parsed.data.workingHoursOverride;
  // Empty object/all-empty-days collapses to "no override" so a half-finished override doesn't
  // lock the host out of bookings on this team — mirrors the per-MT serialiser.
  const isEmpty =
    !next ||
    Object.keys(next).length === 0 ||
    Object.values(next).every((arr) => Array.isArray(arr) && arr.length === 0);

  await prisma.projectMember.update({
    where: { id: memberId },
    data: {
      workingHoursOverride: isEmpty ? Prisma.JsonNull : (next as Prisma.InputJsonValue),
    },
  });

  return NextResponse.json({ ok: true });
}
