import { WorkspaceRole, ProjectRole, type Host } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Returns the host's workspace membership and role. null if they're not a workspace member
// (e.g. external collaborator).
export async function getWorkspaceRole(host: Host) {
  const membership = await prisma.workspaceMember.findFirst({
    where: { hostId: host.id },
    include: { workspace: true },
  });
  return membership;
}

export function canManageWorkspace(role: WorkspaceRole | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ────────────────────────────────────────────────────────────
// Project-level permissions
// ────────────────────────────────────────────────────────────

export async function getProjectMembership(host: Host | { id: string }, projectId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_hostId: { projectId, hostId: host.id } },
  });
}

export function canManageProject(role: ProjectRole | undefined): boolean {
  return role === "LEAD";
}

// Convenience: projects the host can see at all (any membership).
export async function getProjectMembershipsForHost(host: Host) {
  return prisma.projectMember.findMany({
    where: { hostId: host.id },
    include: { project: true },
    orderBy: { addedAt: "asc" },
  });
}
