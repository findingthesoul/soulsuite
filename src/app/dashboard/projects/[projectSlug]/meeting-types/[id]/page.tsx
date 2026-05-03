import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ProjectMeetingTypeForm } from "../form";
import { CopyLinkButton, OpenBookingLink } from "@/components/copy-link-button";
import type { IntakeField } from "@/lib/intake";

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
    prisma.meetingType.findUnique({ where: { id }, include: { intakeForm: true } }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { host: { include: { calendars: true } } },
      orderBy: { addedAt: "asc" },
    }),
  ]);
  if (!mt || mt.scope !== "PROJECT" || mt.projectId !== project.id) notFound();
  const intakeFields = (mt.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/projects" className="hover:text-foreground">Teams</Link>
            {" › "}
            <Link href={`/dashboard/projects/${project.slug}`} className="hover:text-foreground">{project.name}</Link>
            {" › "}
            <span className="text-foreground">{mt.name}</span>
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <CopyLinkButton url={`/${project.slug}/${mt.slug}`} />
            <OpenBookingLink href={`/${project.slug}/${mt.slug}`} label="Open ↗" />
          </div>
        </div>
        <ProjectMeetingTypeForm
          projectId={project.id}
          projectSlug={project.slug}
          members={members.map((m) => ({
            hostId: m.hostId,
            name: m.host.name,
            email: m.host.email,
            isExternal: m.isExternal,
            hasZoom: !!m.host.zoomRefreshToken,
            hasStripe: !!m.host.stripeAccountId,
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
            routingMode: mt.routingMode,
            assignedHostIds: mt.assignedHostIds,
            intakeFields,
            isActive: mt.isActive,
            conferencingProvider: mt.conferencingProvider,
            conferencingHostId: mt.conferencingHostId,
            defaultLocation: mt.defaultLocation,
            maxInvitees: mt.maxInvitees,
            workingHoursOverride: mt.workingHoursOverride as never,
            priceCents: mt.priceCents,
            priceCurrency: mt.priceCurrency,
            paymentMethod: mt.paymentMethod,
          }}
        />
      </div>
    </AppShell>
  );
}
