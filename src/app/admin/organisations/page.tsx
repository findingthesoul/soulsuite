import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganisationsClient } from "./client";

// Soul Suite super-admin page: list every workspace and add new organisations. Gated by
// Host.isSuperAdmin, which is synced from SUPER_ADMIN_EMAILS on every sign-in.

export default async function OrganisationsPage() {
  const ctx = await getPageContextOrRedirect();
  if (!ctx.host.isSuperAdmin) notFound();

  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { members: true, projects: true } },
      members: {
        where: { role: { in: ["OWNER", "ADMIN"] } },
        include: { host: { select: { name: true, email: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Organisations</h1>
          <p className="text-sm text-muted-foreground">
            Every workspace running on Soul Suite. Add a new one by registering its primary
            email domain and the initial owner&apos;s email. The owner becomes OWNER on first
            sign-in (or immediately, if they already exist as a host).
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Existing organisations ({workspaces.length})</CardTitle>
            <CardDescription>
              Each row is one tenant — its members can only see data scoped to their workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {workspaces.map((ws) => (
                <li key={ws.id} className="px-6 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {ws.name}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        @{ws.primaryEmailDomain}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ws._count.members} member{ws._count.members === 1 ? "" : "s"} ·{" "}
                      {ws._count.projects} project{ws._count.projects === 1 ? "" : "s"}
                      {ws.members[0]?.host && (
                        <> · owner {ws.members[0].host.name} &lt;{ws.members[0].host.email}&gt;</>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-subtle-foreground shrink-0">/{ws.slug}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <OrganisationsClient />
      </div>
    </AppShell>
  );
}
