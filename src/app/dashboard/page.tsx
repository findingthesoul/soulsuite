import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { hostHasCompletedOnboarding } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");
  if (!(await hostHasCompletedOnboarding(host))) redirect("/onboarding/calendars");

  const [calendars, workspaceMembership, projectMemberships] = await Promise.all([
    prisma.calendar.findMany({ where: { hostId: host.id } }),
    prisma.workspaceMember.findFirst({
      where: { hostId: host.id },
      include: { workspace: true },
    }),
    prisma.projectMember.findMany({
      where: { hostId: host.id },
      include: { project: true },
    }),
  ]);

  const writeTarget = calendars.find((c) => c.role === "WRITE_TARGET");
  const conflictSources = calendars.filter((c) => c.role === "CONFLICT_CHECK");

  return (
    <main className="min-h-screen p-6 md:p-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Welcome, {host.name}</h1>
            <p className="text-sm text-neutral-500">
              {host.email} · /{host.slug}
              {workspaceMembership && (
                <>
                  {" · "}
                  {workspaceMembership.role.toLowerCase()} of {workspaceMembership.workspace.name}
                </>
              )}
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              Sign out
            </button>
          </form>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Calendars</h2>
          <div className="rounded-lg border border-neutral-200 p-4 text-sm">
            <p>
              <span className="text-neutral-500">Write target: </span>
              {writeTarget ? writeTarget.summary ?? writeTarget.googleCalendarId : "(none)"}
            </p>
            <p className="mt-1">
              <span className="text-neutral-500">Conflict sources: </span>
              {conflictSources.length > 0
                ? conflictSources.map((c) => c.summary ?? c.googleCalendarId).join(", ")
                : "(none)"}
            </p>
            <p className="mt-3">
              <a href="/onboarding/calendars" className="text-sm underline">
                Edit calendar selections
              </a>{" "}
              ·{" "}
              <a href="/onboarding/working-hours" className="text-sm underline">
                Edit working hours
              </a>
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Projects</h2>
          {projectMemberships.length === 0 ? (
            <p className="text-sm text-neutral-500">You aren&apos;t in any projects yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
              {projectMemberships.map((pm) => (
                <li key={pm.id} className="flex items-center justify-between p-3 text-sm">
                  <span>
                    {pm.project.name}{" "}
                    <span className="text-neutral-500">/{pm.project.slug}</span>
                  </span>
                  <span className="text-xs uppercase text-neutral-500">{pm.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
          <p className="font-medium text-neutral-700">Step 1 of build order is live.</p>
          <p className="mt-1">
            Up next: single-host personal meeting type + availability engine + booking flow (no buffers, no
            forms). See <code>soul-scheduler-brief.md §Build order</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
