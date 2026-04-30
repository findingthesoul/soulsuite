import { NextResponse, type NextRequest } from "next/server";
import { InviteKind } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { inviteUrl } from "@/lib/invites";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const { id: projectId, inviteId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.kind !== InviteKind.PROJECT || invite.projectId !== projectId || invite.acceptedAt) {
    return new NextResponse("not found", { status: 404 });
  }

  return NextResponse.json({ url: inviteUrl(invite.token) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const { id: projectId, inviteId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.kind !== InviteKind.PROJECT || invite.projectId !== projectId) {
    return new NextResponse("not found", { status: 404 });
  }

  await prisma.invite.delete({ where: { id: inviteId } });
  return NextResponse.json({ ok: true });
}
