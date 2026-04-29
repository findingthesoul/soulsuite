import Link from "next/link";
import { redirect } from "next/navigation";
import { hostHasCompletedOnboarding } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await getPageContextOrRedirect();
  if (!(await hostHasCompletedOnboarding(ctx.host))) redirect("/onboarding/calendars");

  const [calendars, workspaceRole, projectMemberships] = await Promise.all([
    prisma.calendar.findMany({ where: { hostId: ctx.host.id } }),
    prisma.workspaceMember.findFirst({ where: { hostId: ctx.host.id } }),
    prisma.projectMember.findMany({
      where: { hostId: ctx.host.id },
      include: { project: true },
    }),
  ]);

  const writeTarget = calendars.find((c) => c.role === "WRITE_TARGET");
  const conflictSources = calendars.filter((c) => c.role === "CONFLICT_CHECK");

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {ctx.host.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.host.email} · /{ctx.host.slug}
            {workspaceRole && ctx.workspace && (
              <>
                {" · "}
                {workspaceRole.role.toLowerCase()} of {ctx.workspace.name}
              </>
            )}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Calendars</CardTitle>
              <CardDescription>Where conflicts are checked and bookings are created.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-subtle-foreground">Write target</p>
                <p className="text-foreground">
                  {writeTarget ? writeTarget.summary ?? writeTarget.googleCalendarId : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-subtle-foreground">Conflict sources</p>
                <p className="text-foreground">
                  {conflictSources.length > 0
                    ? conflictSources.map((c) => c.summary ?? c.googleCalendarId).join(", ")
                    : "—"}
                </p>
              </div>
              <div className="flex gap-3 pt-1 text-sm">
                <Link href="/settings/calendars" className="underline text-muted-foreground hover:text-foreground">
                  Edit calendars
                </Link>
                <Link href="/settings/availability" className="underline text-muted-foreground hover:text-foreground">
                  Edit hours
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>Engagements you&apos;re a member of.</CardDescription>
            </CardHeader>
            <CardContent>
              {projectMemberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">You aren&apos;t in any projects yet.</p>
              ) : (
                <ul className="divide-y divide-border -mx-1">
                  {projectMemberships.map((pm) => (
                    <li key={pm.id}>
                      <Link
                        href={`/dashboard/projects/${pm.project.slug}`}
                        className="flex items-center justify-between px-1 py-2 text-sm hover:bg-surface-muted rounded-md -mx-1 px-2"
                      >
                        <div>
                          <p className="font-medium text-foreground">{pm.project.name}</p>
                          <p className="text-xs text-muted-foreground">/{pm.project.slug}</p>
                        </div>
                        <span className="text-xs uppercase tracking-wide text-subtle-foreground">{pm.role}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-3">
                <Link
                  href="/dashboard/projects"
                  className="text-sm underline text-muted-foreground hover:text-foreground"
                >
                  All projects →
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Meeting types</CardTitle>
            <CardDescription>Personal bookable links.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/meeting-types"
              className="text-sm underline text-muted-foreground hover:text-foreground"
            >
              Manage meeting types →
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
