import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ProjectRole } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  hostId: z.string().min(1),
  role: z.enum(["LEAD", "MEMBER"]),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, id);
  if (!membership || !canManageProject(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return new NextResponse("Project not found", { status: 404 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  // The added person must be a workspace member of the project's workspace. External
  // collaborators come via /api/projects/[id]/invites in step 7 of the build order.
  const wsm = await prisma.workspaceMember.findUnique({
    where: { workspaceId_hostId: { workspaceId: project.workspaceId, hostId: parsed.data.hostId } },
  });
  if (!wsm) {
    return new NextResponse("That person isn't a workspace member yet.", { status: 400 });
  }

  try {
    await prisma.projectMember.create({
      data: {
        projectId: id,
        hostId: parsed.data.hostId,
        role: parsed.data.role as ProjectRole,
        isExternal: false,
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse("Already a project member.", { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
