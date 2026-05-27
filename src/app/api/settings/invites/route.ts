import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { InviteKind } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateInviteToken, inviteExpiresAt, inviteUrl } from "@/lib/invites";
import { sendEmailAfterResponse, memberInviteTemplate } from "@/lib/email";

const bodySchema = z.object({
  email: z.string().email().max(200).transform((s) => s.toLowerCase()),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getWorkspaceRole(host);
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const { email, role } = parsed.data;

  // Only OWNER can invite ADMINs (avoids admins escalating peers).
  if (role === "ADMIN" && membership.role !== "OWNER") {
    return new NextResponse("Only the workspace owner can invite admins.", { status: 403 });
  }

  // The invitee's email must end with the workspace's primary email domain. Project-scoped
  // invites (which can have any domain) get a separate endpoint when projects ship.
  const expectedDomain = membership.workspace.primaryEmailDomain.toLowerCase();
  if (!email.endsWith(`@${expectedDomain}`)) {
    return new NextResponse(`Workspace invites must use @${expectedDomain} addresses.`, { status: 400 });
  }

  // Already a member?
  const existingHost = await prisma.host.findUnique({ where: { email } });
  if (existingHost) {
    const existingMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_hostId: { workspaceId: membership.workspaceId, hostId: existingHost.id } },
    });
    if (existingMembership) {
      return new NextResponse(`${email} is already a workspace member.`, { status: 409 });
    }
  }

  // De-duplicate pending invites: if there's an unaccepted invite for this email, replace it.
  await prisma.invite.deleteMany({
    where: {
      kind: InviteKind.WORKSPACE,
      workspaceId: membership.workspaceId,
      email,
      acceptedAt: null,
    },
  });

  const token = generateInviteToken();
  const expiresAt = inviteExpiresAt();
  await prisma.invite.create({
    data: {
      kind: InviteKind.WORKSPACE,
      workspaceId: membership.workspaceId,
      email,
      role,
      token,
      expiresAt,
      invitedByHostId: host.id,
    },
  });

  const tmpl = memberInviteTemplate({
    inviterName: host.name,
    workspaceName: membership.workspace.name,
    scopeLabel: `the ${membership.workspace.name} workspace`,
    acceptUrl: inviteUrl(token),
    recipientEmail: email,
    expiresAt,
  });
  sendEmailAfterResponse({
    to: email,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    // Invite emails read as plain `Soul Suite <notify@…>` rather than "Sjoerd via Soul Suite"
    // — the inviter's name is already in the subject + body, so prefixing the From loops
    // ("Sjoerd invited you to Sjoerd's project").
    replyTo: host.email,
  });

  return NextResponse.json({ ok: true });
}
