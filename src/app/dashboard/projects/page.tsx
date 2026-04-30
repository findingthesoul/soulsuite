import Link from "next/link";
import { Plus } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getProjectMembershipsForHost, getWorkspaceRole } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function ProjectsListPage() {
  const ctx = await getPageContextOrRedirect();
  const [memberships, workspaceMembership] = await Promise.all([
    getProjectMembershipsForHost(ctx.host),
    getWorkspaceRole(ctx.host),
  ]);
  const canCreate = workspaceMembership !== null;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
            <p className="text-sm text-muted-foreground">
              Shared engagements you&apos;re a member of. Each team owns its own meeting types and round-robin
              routing.
            </p>
          </div>
          {canCreate && (
            <Link href="/dashboard/projects/new" className={buttonVariants()}>
              <Plus className="h-4 w-4" />
              New team
            </Link>
          )}
        </header>

        {memberships.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">You&apos;re not in any projects yet.</p>
              {canCreate && (
                <Link href="/dashboard/projects/new" className={buttonVariants()}>
                  Create the first
                </Link>
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {memberships.map((pm) => (
                <li key={pm.id}>
                  <Link
                    href={`/dashboard/projects/${pm.project.slug}`}
                    className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {pm.project.name}
                        {!pm.project.isActive && (
                          <span className="ml-2 text-xs uppercase tracking-wide text-subtle-foreground">archived</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        /{pm.project.slug}
                        {pm.project.description ? ` · ${pm.project.description}` : ""}
                      </p>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
                      {pm.role}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
