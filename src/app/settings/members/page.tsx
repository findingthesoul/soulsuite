import { redirect } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MembersClient } from "./client";
import { inviteUrl } from "@/lib/invites";

export default async function MembersSettingsPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);
  // No workspace at all — bounce to dashboard. We never want a 404 from a sidebar link.
  if (!membership) redirect("/dashboard");
  // Workspace member but not an owner/admin — render a friendly explanation instead of 404.
  if (!canManageWorkspace(membership.role)) {
    return (
      <AppShell {...shellProps(ctx)}>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Internal team</h1>
            <p className="text-sm text-muted-foreground">
              Only workspace owners and admins can manage internal team members.
            </p>
          </header>
          <Card>
            <CardHeader>
              <CardTitle>You don&apos;t have access</CardTitle>
              <CardDescription>
                Ask an owner of <strong>{membership.workspace.name}</strong> to invite or manage
                people on your behalf, or to promote you to admin if you should have access.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AppShell>
    );
  }

  const [members, invites] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId },
      include: { host: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.invite.findMany({
      where: { kind: "WORKSPACE", workspaceId: membership.workspaceId, acceptedAt: null },
      include: { invitedBy: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Current user can't change their own role here (avoid the "lock yourself out" footgun).
  // Owner can demote/promote others; admins can promote members or demote admins; members can do nothing.
  const myRole = membership.role;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Internal team</h1>
          <p className="text-sm text-muted-foreground">
            People with an @{membership.workspace.primaryEmailDomain} account who can sign in to Soul Suite.
            External collaborators don&apos;t live here — add them per Team instead.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Current internal team ({members.length})</CardTitle>
            <CardDescription>The people who can sign in to Soul Suite.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mx-1">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{m.host.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.host.email}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-subtle-foreground shrink-0">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <MembersClient
          myRole={myRole}
          primaryEmailDomain={membership.workspace.primaryEmailDomain}
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            invitedByName: i.invitedBy.name,
            createdAt: i.createdAt.toISOString(),
            expiresAt: i.expiresAt.toISOString(),
            url: inviteUrl(i.token),
          }))}
        />
      </div>
    </AppShell>
  );
}
