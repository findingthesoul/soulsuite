import { NextResponse, type NextRequest } from "next/server";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getWorkspaceRole(host);
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite || invite.workspaceId !== membership.workspaceId) {
    return new NextResponse("Invite not found.", { status: 404 });
  }
  if (invite.acceptedAt) {
    return new NextResponse("Already accepted — can't revoke.", { status: 409 });
  }

  await prisma.invite.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
