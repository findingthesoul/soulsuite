import { redirect } from "next/navigation";
import { unstable_cache, revalidateTag } from "next/cache";
import type { Host, WorkspaceRole } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageWorkspace } from "@/lib/permissions";

export interface PageContext {
  host: Host;
  workspace: {
    id: string;
    name: string;
    logoUrl: string | null;
    brandColor: string | null;
    role: WorkspaceRole;
  } | null;
}

// Workspace branding rarely changes (logo + name + brand colour edits land via
// /settings/workspace and /settings/branding). Cache the lookup for 5 minutes per host;
// the settings-write endpoints call `revalidateWorkspaceForHost(hostId)` to bust on edit.
//
// The Host row itself isn't cached because profile edits (name, photo, timezone) need to be
// reflected immediately in the AppShell — the host findUnique is a single-row indexed lookup
// and is cheap; the workspace include was the expensive part.
function workspaceTag(hostId: string) {
  return `workspace-for-host:${hostId}`;
}

const fetchWorkspaceForHost = unstable_cache(
  async (hostId: string) => {
    const membership = await prisma.workspaceMember.findFirst({
      where: { hostId },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, logoUrl: true, brandColor: true } },
      },
    });
    if (!membership?.workspace) return null;
    return { ...membership.workspace, role: membership.role };
  },
  ["workspace-for-host"],
  { revalidate: 300, tags: ["workspace-for-host"] },
);

export function revalidateWorkspaceForHost(hostId: string): void {
  revalidateTag(workspaceTag(hostId));
  revalidateTag("workspace-for-host");
}

// Server helper used by every authenticated page. The host lookup is cheap (indexed on
// authUserId); the workspace lookup is cached.
export async function getPageContextOrRedirect(): Promise<PageContext> {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");
  const workspace = await fetchWorkspaceForHost(host.id);
  return { host, workspace };
}

// Convenience for AppShell props.
export function shellProps(ctx: PageContext) {
  return {
    user: { name: ctx.host.name, email: ctx.host.email },
    workspaceName: ctx.workspace?.name,
    logoUrl: ctx.workspace?.logoUrl ?? null,
    brandColor: ctx.workspace?.brandColor ?? null,
    hasWorkspace: !!ctx.workspace,
    canManageWorkspace: ctx.workspace ? canManageWorkspace(ctx.workspace.role) : false,
    isSuperAdmin: ctx.host.isSuperAdmin,
  };
}
