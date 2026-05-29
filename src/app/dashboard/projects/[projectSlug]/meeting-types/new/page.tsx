import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ProjectMeetingTypeForm } from "../form";

export default async function NewProjectMeetingTypePage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  const ctx = await getPageContextOrRedirect();

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) notFound();
  const membership = await getProjectMembership(ctx.host, project.id);
  if (!membership || !canManageProject(membership.role)) notFound();

  const members = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    include: { host: { include: { calendars: true } } },
    orderBy: { addedAt: "asc" },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          <Link href="/dashboard/projects" className="hover:text-foreground">Teams</Link>
          {" › "}
          <Link href={`/dashboard/projects/${project.slug}`} className="hover:text-foreground">{project.name}</Link>
          {" › "}
          <span className="text-foreground">New meeting type</span>
        </p>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New meeting type</h1>
          <p className="text-sm text-muted-foreground">
            Bookable at <code className="text-xs">/{project.slug}/&lt;slug&gt;</code> once saved.
          </p>
        </header>
        <ProjectMeetingTypeForm
          projectId={project.id}
          projectSlug={project.slug}
          members={serializeMembers(members)}
        />
      </div>
    </AppShell>
  );
}

function serializeMembers(
  members: Awaited<ReturnType<typeof prisma.projectMember.findMany<{ include: { host: { include: { calendars: true } } } }>>>,
) {
  return members.map((m) => ({
    hostId: m.hostId,
    name: m.host.name,
    email: m.host.email,
    isExternal: m.isExternal,
    hasZoom: !!m.host.zoomRefreshToken,
    hasStripe: !!m.host.stripeAccountId,
    hasPersonalZoomRoom: !!m.host.personalZoomRoomUrl,
    hasPersonalTeamsRoom: !!m.host.personalTeamsRoomUrl,
    calendars: m.host.calendars.map((c) => ({
      id: c.id,
      summary: c.summary ?? c.googleCalendarId,
      role: c.role,
    })),
  }));
}
