import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { InviteKind } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateInviteToken, inviteExpiresAt, inviteUrl } from "@/lib/invites";
import { sendEmail, memberInviteTemplate } from "@/lib/email";

const bodySchema = z.object({
  email: z.string().email().max(200).transform((s) => s.toLowerCase()),
  role: z.enum(["LEAD", "MEMBER"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, projectId);
  if (!membership || !canManageProject(membership.role)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const { email, role } = parsed.data;

  // Already a project member?
  const existingHost = await prisma.host.findUnique({ where: { email } });
  if (existingHost) {
    const existingMembership = await prisma.projectMember.findUnique({
      where: { projectId_hostId: { projectId, hostId: existingHost.id } },
    });
    if (existingMembership) {
      return new NextResponse(`${email} is already on this project.`, { status: 409 });
    }
  }

  // Replace any existing pending invite for this email+project.
  await prisma.invite.deleteMany({
    where: { kind: InviteKind.PROJECT, projectId, email, acceptedAt: null },
  });

  const token = generateInviteToken();
  const expiresAt = inviteExpiresAt();
  await prisma.invite.create({
    data: {
      kind: InviteKind.PROJECT,
      projectId,
      email,
      role,
      token,
      expiresAt,
      invitedByHostId: host.id,
    },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, workspace: { select: { name: true } } },
  });
  if (project) {
    const tmpl = memberInviteTemplate({
      inviterName: host.name,
      workspaceName: project.workspace.name,
      scopeLabel: `the ${project.name} project`,
      acceptUrl: inviteUrl(token),
      recipientEmail: email,
      expiresAt,
    });
    void sendEmail({
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      // No fromName: invite emails read as plain `Soul Suite <notify@…>`. The inviter's
      // name is already in the subject + body; prefixing the From loops awkwardly
      // ("Sjoerd invited you to Sjoerd's project").
      replyTo: host.email,
    });
  }

  return NextResponse.json({ ok: true, url: inviteUrl(token) });
}
