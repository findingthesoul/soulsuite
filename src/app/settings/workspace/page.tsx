import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { WorkspaceSettingsForm } from "./form";

export default async function WorkspaceSettingsPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);
  if (!membership || !canManageWorkspace(membership.role)) notFound();

  const ws = membership.workspace;
  // Count of meeting types that depend on each shared room URL — surfaced as a warn-on-clear
  // counter, same UX as personal rooms on the profile page.
  const [sharedZoomMtCount, sharedTeamsMtCount] = await Promise.all([
    prisma.meetingType.count({
      where: {
        conferencingProvider: "WORKSPACE_ZOOM_ROOM",
        OR: [
          { hostId: { in: (await prisma.workspaceMember.findMany({ where: { workspaceId: ws.id }, select: { hostId: true } })).map((m) => m.hostId) } },
          { project: { workspaceId: ws.id } },
        ],
      },
    }),
    prisma.meetingType.count({
      where: {
        conferencingProvider: "WORKSPACE_TEAMS_ROOM",
        OR: [
          { hostId: { in: (await prisma.workspaceMember.findMany({ where: { workspaceId: ws.id }, select: { hostId: true } })).map((m) => m.hostId) } },
          { project: { workspaceId: ws.id } },
        ],
      },
    }),
  ]);
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl">
        <WorkspaceSettingsForm
          initial={{
            name: ws.name,
            slug: ws.slug,
            primaryEmailDomain: ws.primaryEmailDomain,
            sharedZoomRoomUrl: ws.sharedZoomRoomUrl,
            sharedTeamsRoomUrl: ws.sharedTeamsRoomUrl,
            sharedZoomMtCount,
            sharedTeamsMtCount,
          }}
        />
      </div>
    </AppShell>
  );
}
