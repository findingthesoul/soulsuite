import { WorkspaceRole, ProjectRole, type Host, type Workspace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { domainOf } from "@/lib/auth";

// Outcome of post-sign-in routing. The callback uses this to decide where to redirect.
export type BootstrapOutcome =
  | { kind: "needs-onboarding"; host: Host; workspace: Workspace }
  | { kind: "ready"; host: Host; workspace: Workspace }
  | { kind: "external-collaborator"; host: Host }
  | { kind: "needs-access-request"; host: Host }
  | { kind: "rejected"; reason: string };

// Look up the workspace this email's domain belongs to. Multi-tenant: each Workspace owns
// exactly one primaryEmailDomain. Returns null when no organisation has registered the domain.
export async function workspaceForEmail(email: string): Promise<Workspace | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  return prisma.workspace.findUnique({ where: { primaryEmailDomain: domain } });
}

// Bootstrap path: when no Workspace rows exist AND the signing-in user's domain matches the
// seed env var, create the first workspace and make them OWNER. Past that, /admin/organisations
// is the canonical way to add organisations.
async function bootstrapSeedWorkspace(host: Host): Promise<Workspace | null> {
  const env = serverEnv();
  const seed = env.WORKSPACE_PRIMARY_EMAIL_DOMAIN?.toLowerCase();
  const hostDomain = domainOf(host.email);
  if (!seed || !hostDomain || hostDomain !== seed) return null;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findFirst({});
    if (existing) return existing;
    const workspace = await tx.workspace.create({
      data: {
        // First-install niceties: derive a readable name from the domain ("acme.com" → "Acme").
        // Super-admins can rename later under /settings/workspace.
        name: prettyNameFromDomain(seed),
        slug: slugFromDomain(seed),
        primaryEmailDomain: seed,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, hostId: host.id, role: WorkspaceRole.OWNER },
    });
    return workspace;
  });
}

function prettyNameFromDomain(domain: string): string {
  const root = domain.split(".")[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function slugFromDomain(domain: string): string {
  return domain.split(".")[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "workspace";
}

// Walks the post-sign-in decision tree. Pure function over DB state — no redirects here.
export async function resolvePostSignIn(host: Host): Promise<BootstrapOutcome> {
  const workspace = await workspaceForEmail(host.email);

  // Workspace registered for this domain → membership path.
  if (workspace) {
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

    // Domain matches but no membership/invite — route to /request-access so a workspace
    // owner can decide whether to admit. Preserves the v1 behaviour and keeps the door
    // closed by default for orgs that don't want auto-join.
    return { kind: "needs-access-request", host };
  }

  // No workspace for this domain yet. Try the first-install bootstrap.
  const bootstrapped = await bootstrapSeedWorkspace(host);
  if (bootstrapped) return needsOnboardingOrReady(host, bootstrapped);

  // External collaborator path: must have a pending project invite or an existing membership.
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
  const anyProjectMembership = await prisma.projectMember.findFirst({ where: { hostId: host.id } });
  if (anyProjectMembership) return { kind: "external-collaborator", host };

  return {
    kind: "rejected",
    reason: "Your email domain isn't on Soul Suite yet. Ask your organisation admin to set it up, or sign in via a project invite.",
  };
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
  // External = email domain doesn't match ANY workspace's primaryEmailDomain. Internal
  // collaborators who later get invited to a different workspace's project are still
  // technically "external" to that workspace — keep it simple and flag isExternal=true unless
  // the email's domain matches some registered workspace.
  const matchingWorkspace = await workspaceForEmail(host.email);
  const isExternal = !matchingWorkspace;
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

// Lightweight check used by route guards once the host already exists. One DB round-trip:
// if there's any WRITE_TARGET calendar, the host has ≥ 1 calendar by construction. Working
// hours is on the host object so no extra query.
export async function hostHasCompletedOnboarding(host: Host): Promise<boolean> {
  if (host.workingHours === null) return false;
  const writeTarget = await prisma.calendar.findFirst({
    where: { hostId: host.id, role: "WRITE_TARGET" },
    select: { id: true },
  });
  return writeTarget !== null;
}
