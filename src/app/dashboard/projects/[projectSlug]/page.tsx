import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { publicEnv } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CopyLinkButton, OpenBookingLink } from "@/components/copy-link-button";
import { NewSchedulingMenu } from "@/components/new-scheduling-menu";
import { ProjectDetailsForm } from "./form";

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  const ctx = await getPageContextOrRedirect();

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) notFound();

  const membership = await getProjectMembership(ctx.host, project.id);
  if (!membership) notFound(); // Project members only — keeps content private from non-members.
  const isLead = canManageProject(membership.role);

  const [members, meetingTypes] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { host: true },
      orderBy: { addedAt: "asc" },
    }),
    prisma.meetingType.findMany({
      where: { scope: "PROJECT", projectId: project.id, isOneOff: false },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-8">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/projects" className="hover:text-foreground">Teams</Link>
          </p>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
            {!project.isActive && (
              <span className="text-xs uppercase tracking-wide text-subtle-foreground border border-border rounded-md px-2 py-0.5">
                Archived
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            /{project.slug}
            {project.description ? ` · ${project.description}` : ""}
          </p>
        </header>

        <ProjectDetailsForm
          canEdit={isLead}
          initial={{ name: project.name, slug: project.slug, description: project.description, isActive: project.isActive }}
          projectId={project.id}
        />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
              Team ({members.length})
            </h2>
            {isLead && (
              <Link
                href={`/dashboard/projects/${project.slug}/members`}
                className="text-sm underline text-muted-foreground hover:text-foreground"
              >
                Manage
              </Link>
            )}
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{m.host.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.host.email}
                      {m.isExternal && " · external"}
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
              Meeting types ({meetingTypes.length})
            </h2>
            {isLead && <NewSchedulingMenu context="team" projectSlug={project.slug} />}
          </div>
          {meetingTypes.length === 0 ? (
            <Card className="border-dashed">
              <div className="p-6 text-center text-sm text-muted-foreground">
                No project meeting types yet.
                {isLead && (
                  <>
                    {" "}
                    <Link
                      href={`/dashboard/projects/${project.slug}/meeting-types/new`}
                      className="underline hover:text-foreground"
                    >
                      Create the first
                    </Link>
                    .
                  </>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {meetingTypes.map((mt) => {
                  const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/${project.slug}/${mt.slug}`;
                  return (
                    <li key={mt.id}>
                      <Link
                        href={`/dashboard/projects/${project.slug}/meeting-types/${mt.id}`}
                        className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground flex items-center gap-2 flex-wrap">
                            <span>{mt.name}</span>
                            <span className="text-xs uppercase tracking-wide text-subtle-foreground border border-border rounded-md px-1.5 py-0.5">
                              {mt.maxInvitees > 1
                                ? "Group"
                                : mt.routingMode === "ROUND_ROBIN"
                                  ? "Round-robin"
                                  : mt.routingMode === "COLLECTIVE"
                                    ? "Collective"
                                    : "Single"}
                            </span>
                            {!mt.isActive && (
                              <span className="text-xs uppercase tracking-wide text-subtle-foreground">inactive</span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {mt.durationMinutes} min · {url}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <CopyLinkButton url={`/${project.slug}/${mt.slug}`} />
                          <OpenBookingLink href={`/${project.slug}/${mt.slug}`} label="Open ↗" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </AppShell>
  );
}
