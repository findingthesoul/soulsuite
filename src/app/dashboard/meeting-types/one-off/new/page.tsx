import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { OneOffMeetingTypeForm } from "./form";

export default async function NewOneOffMeetingTypePage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await prisma.workspaceMember.findFirst({
    where: { hostId: ctx.host.id },
    include: { workspace: true },
  });
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New one-off meeting</h1>
          <p className="text-sm text-muted-foreground">
            Hand-pick specific time slots — invitees claim a slot directly without checking availability.
          </p>
        </header>
        <OneOffMeetingTypeForm
          hostSlug={ctx.host.slug}
          hostHasZoom={!!ctx.host.zoomRefreshToken}
          hostHasPersonalZoomRoom={!!ctx.host.personalZoomRoomUrl}
          hostHasPersonalTeamsRoom={!!ctx.host.personalTeamsRoomUrl}
          workspaceHasZoomRoom={!!membership?.workspace.sharedZoomRoomUrl}
          workspaceHasTeamsRoom={!!membership?.workspace.sharedTeamsRoomUrl}
        />
      </div>
    </AppShell>
  );
}
