import { redirect } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { NewProjectForm } from "./form";

export default async function NewProjectPage() {
  const ctx = await getPageContextOrRedirect();
  // Per brief §3: any workspace member can create a project. External collaborators can't.
  const membership = await getWorkspaceRole(ctx.host);
  if (!membership) redirect("/dashboard/projects");

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be the first lead. Add other workspace members or external collaborators later.
          </p>
        </header>
        <NewProjectForm />
      </div>
    </AppShell>
  );
}
