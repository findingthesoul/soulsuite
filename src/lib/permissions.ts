import { WorkspaceRole, type Host } from "@prisma/client";
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
