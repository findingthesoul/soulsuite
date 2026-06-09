import { redirect } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { TeamMeetingForm } from "./form";

// Internal team meeting: pick teammates → see mutual availability → create a Google Calendar
// event with everyone on it. Distinct from /dashboard/book (which uses meeting types + Soul
// Suite booking scaffolding) — this is the "quick 30 min with the team" path that doesn't
// need an MT to be defined first.

export default async function TeamMeetingPage() {
  const ctx = await getPageContextOrRedirect();
  if (!ctx.workspace) redirect("/dashboard"); // no workspace = no teammates to pick from

  // Workspace members (excluding the caller — implicitly added on submit). Active members only;
  // pending invites don't show up here because they have no Host row yet.
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ctx.workspace.id, hostId: { not: ctx.host.id } },
    include: { host: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });

  // Shared-room availability — used to populate the conferencing dropdown without lying about
  // options the workspace hasn't enabled yet.
  const workspace = await prisma.workspace.findUnique({
    where: { id: ctx.workspace.id },
    select: { sharedZoomRoomUrl: true, sharedTeamsRoomUrl: true },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team meeting</h1>
          <p className="text-sm text-muted-foreground">
            Pick teammates and a duration — we&apos;ll show times when everyone&apos;s free.
            Booking creates a calendar event with everyone invited; Google sends the invites.
          </p>
        </header>
        <TeamMeetingForm
          callerName={ctx.host.name}
          attendees={members.map((m) => ({
            id: m.host.id,
            name: m.host.name,
            email: m.host.email,
          }))}
          workspaceHasZoomRoom={!!workspace?.sharedZoomRoomUrl}
          workspaceHasTeamsRoom={!!workspace?.sharedTeamsRoomUrl}
        />
      </div>
    </AppShell>
  );
}
