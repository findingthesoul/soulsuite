import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ProjectMeetingTypeForm } from "../form";

export default async function EditProjectMeetingTypePage({
  params,
}: {
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const { projectSlug, id } = await params;
  const ctx = await getPageContextOrRedirect();

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) notFound();
  const membership = await getProjectMembership(ctx.host, project.id);
  if (!membership || !canManageProject(membership.role)) notFound();

  const [mt, members] = await Promise.all([
    prisma.meetingType.findUnique({ where: { id } }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { host: { include: { calendars: true } } },
      orderBy: { addedAt: "asc" },
    }),
  ]);
  if (!mt || mt.scope !== "PROJECT" || mt.projectId !== project.id) notFound();

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit meeting type</h1>
          <p className="text-sm text-muted-foreground">
            Booking link: <code className="text-xs">/{project.slug}/{mt.slug}</code>
          </p>
        </header>
        <ProjectMeetingTypeForm
          projectId={project.id}
          projectSlug={project.slug}
          members={members.map((m) => ({
            hostId: m.hostId,
            name: m.host.name,
            email: m.host.email,
            isExternal: m.isExternal,
            calendars: m.host.calendars.map((c) => ({
              id: c.id,
              summary: c.summary ?? c.googleCalendarId,
              role: c.role,
            })),
          }))}
          initial={{
            id: mt.id,
            name: mt.name,
            slug: mt.slug,
            description: mt.description,
            durationMinutes: mt.durationMinutes,
            bufferBeforeMinutes: mt.bufferBeforeMinutes,
            bufferAfterMinutes: mt.bufferAfterMinutes,
            minNoticeMinutes: mt.minNoticeMinutes,
            maxAdvanceDays: mt.maxAdvanceDays,
            conflictCalendarIds: mt.conflictCalendarIds,
            assignedHostIds: mt.assignedHostIds,
            isActive: mt.isActive,
          }}
        />
      </div>
    </AppShell>
  );
}
