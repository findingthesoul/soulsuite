import { WorkspaceRole, ProjectRole, type Host, type Workspace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { isWorkspaceDomain } from "@/lib/auth";

// Outcome of post-sign-in routing. The callback uses this to decide where to redirect.
export type BootstrapOutcome =
  | { kind: "needs-onboarding"; host: Host; workspace: Workspace }
  | { kind: "ready"; host: Host; workspace: Workspace }
  | { kind: "external-collaborator"; host: Host }
  | { kind: "needs-access-request"; host: Host }
  | { kind: "rejected"; reason: string };

// V1: single workspace. First @soul.com sign-in creates it and becomes OWNER.
// The schema is multi-tenant, but the UI doesn't expose workspace selection yet.
async function getOrCreatePrimaryWorkspace(): Promise<Workspace | null> {
  return prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
}

async function bootstrapPrimaryWorkspace(host: Host): Promise<Workspace> {
  const env = serverEnv();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    const workspace = await tx.workspace.create({
      data: {
        name: "Soul",
        slug: "soul",
        primaryEmailDomain: env.WORKSPACE_PRIMARY_EMAIL_DOMAIN,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, hostId: host.id, role: WorkspaceRole.OWNER },
    });
    return workspace;
  });
}

// Walks the post-sign-in decision tree. Pure function over DB state — no redirects here.
export async function resolvePostSignIn(host: Host): Promise<BootstrapOutcome> {
  const matchesDomain = isWorkspaceDomain(host.email);
  const workspace = await getOrCreatePrimaryWorkspace();

  // Domain match: workspace member path.
  if (matchesDomain) {
    // First @soul.com user ever — bootstrap workspace + make them owner.
    if (!workspace) {
      const created = await bootstrapPrimaryWorkspace(host);
      return needsOnboardingOrReady(host, created);
    }

    // Already a member?
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_hostId: { workspaceId: workspace.id, hostId: host.id } },
    });
    if (membership) return needsOnboardingOrReady(host, workspace);

    // Pending workspace invite for this email?
    const invite = await prisma.invite.findFirst({
      where: {
        kind: "WORKSPACE",
        workspaceId: workspace.id,
        email: host.email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (invite) {
      await acceptWorkspaceInvite(host, workspace, invite.id, invite.role as WorkspaceRole);
      return needsOnboardingOrReady(host, workspace);
    }

    return { kind: "needs-access-request", host };
  }

  // External collaborator path: must have a pending project invite.
  if (!workspace) return { kind: "rejected", reason: "Workspace has not been set up yet." };

  const projectInvite = await prisma.invite.findFirst({
    where: {
      kind: "PROJECT",
      email: host.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (projectInvite) {
    await acceptProjectInvite(host, projectInvite.id, projectInvite.projectId!, projectInvite.role as ProjectRole);
    return { kind: "external-collaborator", host };
  }

  // Already a project member from a previous invite?
  const anyProjectMembership = await prisma.projectMember.findFirst({ where: { hostId: host.id } });
  if (anyProjectMembership) return { kind: "external-collaborator", host };

  return { kind: "rejected", reason: `Sign-in requires either an @${serverEnv().WORKSPACE_PRIMARY_EMAIL_DOMAIN} email or a project invite.` };
}

async function acceptWorkspaceInvite(host: Host, workspace: Workspace, inviteId: string, role: WorkspaceRole) {
  await prisma.$transaction([
    prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, hostId: host.id, role },
    }),
    prisma.invite.update({
      where: { id: inviteId },
      data: { acceptedAt: new Date() },
    }),
  ]);
}

async function acceptProjectInvite(host: Host, inviteId: string, projectId: string, role: ProjectRole) {
  const isExternal = !isWorkspaceDomain(host.email);
  await prisma.$transaction([
    prisma.projectMember.create({
      data: { projectId, hostId: host.id, role, isExternal },
    }),
    prisma.invite.update({
      where: { id: inviteId },
      data: { acceptedAt: new Date() },
    }),
  ]);
}

function needsOnboardingOrReady(host: Host, workspace: Workspace): BootstrapOutcome {
  // "Ready" once the host has at least one calendar configured + working hours set.
  // Until then, route them through onboarding so the availability engine has data to work with.
  return { kind: "needs-onboarding", host, workspace };
}

// Lightweight check used by route guards once the host already exists.
export async function hostHasCompletedOnboarding(host: Host): Promise<boolean> {
  const [calCount, hasWriteTarget] = await Promise.all([
    prisma.calendar.count({ where: { hostId: host.id } }),
    prisma.calendar.findFirst({ where: { hostId: host.id, role: "WRITE_TARGET" } }),
  ]);
  return calCount > 0 && hasWriteTarget !== null && host.workingHours !== null;
}
