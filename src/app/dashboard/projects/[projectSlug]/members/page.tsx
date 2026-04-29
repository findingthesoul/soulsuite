import { notFound } from "next/navigation";
import Link from "next/link";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ProjectMembersClient } from "./client";

export default async function ProjectMembersPage({
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

  // Pull every project member + every workspace member, so the picker can show available
  // workspace members not yet on the project.
  const [projectMembers, workspaceMembers] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { host: true },
      orderBy: { addedAt: "asc" },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: project.workspaceId },
      include: { host: true },
      orderBy: { joinedAt: "asc" },
    }),
  ]);

  const inProjectHostIds = new Set(projectMembers.map((m) => m.hostId));
  const candidates = workspaceMembers
    .filter((m) => !inProjectHostIds.has(m.hostId))
    .map((m) => ({ id: m.host.id, name: m.host.name, email: m.host.email }));

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/dashboard/projects/${project.slug}`} className="hover:text-foreground">
              {project.name}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            Add other workspace members to this project. External collaborators (any-domain) come in a future step.
          </p>
        </header>
        <ProjectMembersClient
          projectId={project.id}
          currentHostId={ctx.host.id}
          members={projectMembers.map((m) => ({
            id: m.id,
            hostId: m.hostId,
            name: m.host.name,
            email: m.host.email,
            role: m.role,
            isExternal: m.isExternal,
          }))}
          candidates={candidates}
        />
      </div>
    </AppShell>
  );
}
