import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ProjectRole } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  role: z.enum(["LEAD", "MEMBER"]),
});

async function authorize(hostId: string, projectId: string): Promise<boolean> {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_hostId: { projectId, hostId } },
  });
  return canManageProject(m?.role);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await authorize(host.id, id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = await prisma.projectMember.findUnique({ where: { id: memberId } });
  if (!target || target.projectId !== id) return new NextResponse("Member not found", { status: 404 });

  // Avoid demoting yourself if you're the only LEAD — would orphan the project.
  if (target.hostId === host.id) {
    return new NextResponse("Use the members list to change another lead's role first.", { status: 409 });
  }

  const json = await request.json();
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  await prisma.projectMember.update({
    where: { id: memberId },
    data: { role: parsed.data.role as ProjectRole },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await authorize(host.id, id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = await prisma.projectMember.findUnique({ where: { id: memberId } });
  if (!target || target.projectId !== id) return new NextResponse("Member not found", { status: 404 });

  if (target.hostId === host.id) {
    return new NextResponse("You can't remove yourself. Ask another lead.", { status: 409 });
  }

  // If the target host is assigned to any project meeting types, removing them silently breaks
  // those bookings. Surface the error instead.
  const stillAssigned = await prisma.meetingType.findFirst({
    where: { scope: "PROJECT", projectId: id, assignedHostIds: { has: target.hostId } },
  });
  if (stillAssigned) {
    return new NextResponse(
      `${target.hostId} is assigned to a project meeting type. Reassign or deactivate it first.`,
      { status: 409 },
    );
  }

  await prisma.projectMember.delete({ where: { id: memberId } });
  return NextResponse.json({ ok: true });
}
