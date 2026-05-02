import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { canManageProject, getProjectMembership } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { coerceSchedule, type Schedule } from "@/components/working-hours-editor";
import { ProjectMemberAvailabilityForm } from "./form";

export default async function ProjectMemberAvailabilityPage({
  params,
}: {
  params: Promise<{ projectSlug: string; memberId: string }>;
}) {
  const { projectSlug, memberId } = await params;
  const ctx = await getPageContextOrRedirect();

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) notFound();

  const callerMembership = await getProjectMembership(ctx.host, project.id);
  if (!callerMembership) notFound();

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { host: true },
  });
  if (!member || member.projectId !== project.id) notFound();

  const isSelf = member.hostId === ctx.host.id;
  const canEdit = isSelf || canManageProject(callerMembership.role);
  if (!canEdit) notFound();

  // Initial: null = "use default working hours". Anything truthy → custom schedule.
  const initialOverride: Schedule | null =
    member.workingHoursOverride && typeof member.workingHoursOverride === "object"
      ? coerceSchedule(member.workingHoursOverride)
      : null;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/dashboard/projects/${project.slug}`} className="hover:text-foreground">
              {project.name}
            </Link>
            {" · "}
            <Link
              href={`/dashboard/projects/${project.slug}/members`}
              className="hover:text-foreground"
            >
              Team
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSelf ? "My working hours for this team" : `${member.host.name}'s working hours`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Optional override. When unset, the host&apos;s default{" "}
            <Link href="/settings/availability" className="underline">working hours</Link>{" "}
            apply for project meeting types on this team.
          </p>
        </header>

        <ProjectMemberAvailabilityForm
          projectId={project.id}
          memberId={member.id}
          initialOverride={initialOverride}
        />
      </div>
    </AppShell>
  );
}
