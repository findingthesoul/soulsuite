import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { BrandingForm } from "./form";

export default async function BrandingSettingsPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);
  if (!membership || !canManageWorkspace(membership.role)) notFound();

  const ws = membership.workspace;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Logo and brand colour for {ws.name}. Used in the app header and (later) on public booking pages.
          </p>
        </header>
        <BrandingForm
          initial={{ name: ws.name, logoUrl: ws.logoUrl, brandColor: ws.brandColor }}
        />
      </div>
    </AppShell>
  );
}
