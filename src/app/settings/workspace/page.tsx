import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { WorkspaceSettingsForm } from "./form";

export default async function WorkspaceSettingsPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);
  if (!membership || !canManageWorkspace(membership.role)) notFound();

  const ws = membership.workspace;
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
          <p className="text-sm text-muted-foreground">Identity and the email domain that defines who can join.</p>
        </header>
        <WorkspaceSettingsForm
          initial={{
            name: ws.name,
            slug: ws.slug,
            primaryEmailDomain: ws.primaryEmailDomain,
          }}
        />
      </div>
    </AppShell>
  );
}
