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

  // Four queries: this project's members, all workspace members (for the internal picker),
  // pending invites, and external collaborators from any other project (so we can suggest
  // re-using folks the team already worked with).
  const [projectMembers, workspaceMembers, pendingInvites, pastExternals] = await Promise.all([
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
    prisma.invite.findMany({
      where: { projectId: project.id, kind: "PROJECT", acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.projectMember.findMany({
      where: { isExternal: true, project: { workspaceId: project.workspaceId } },
      include: { host: true },
      orderBy: { addedAt: "desc" },
    }),
  ]);

  // Combine workspace members + past external collaborators into one searchable list of
  // "people you can add directly without sending an email". Internal first, then externals,
  // each tagged so the UI can show a badge.
  const inProjectHostIds = new Set(projectMembers.map((m) => m.hostId));
  const internalCandidates = workspaceMembers
    .filter((m) => !inProjectHostIds.has(m.hostId))
    .map((m) => ({
      id: m.host.id,
      name: m.host.name,
      email: m.host.email,
      kind: "internal" as const,
    }));
  const seenExternalIds = new Set<string>();
  const externalCandidates = pastExternals
    .filter((m) => {
      if (inProjectHostIds.has(m.hostId)) return false;
      if (seenExternalIds.has(m.hostId)) return false;
      seenExternalIds.add(m.hostId);
      return true;
    })
    .map((m) => ({
      id: m.host.id,
      name: m.host.name,
      email: m.host.email,
      kind: "external" as const,
    }));
  const candidates = [...internalCandidates, ...externalCandidates];

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/dashboard/projects/${project.slug}`} className="hover:text-foreground">
              {project.name}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Team members</h1>
          <p className="text-sm text-muted-foreground">
            Add internal teammates and past external collaborators directly, or invite new people by email.
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
          pendingInvites={pendingInvites.map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role,
            expiresAt: inv.expiresAt.toISOString(),
          }))}
        />
      </div>
    </AppShell>
  );
}
