import { redirect } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { PaymentsForm } from "./form";

// Workspace-internal users only — external project collaborators don't manage payments.
// Payments are tied to the host's own Stripe account, not the workspace, but we still gate to
// internal members to keep the surface small.
export default async function PaymentsSettingsPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);
  if (!membership) redirect("/dashboard");

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl">
        <PaymentsForm
          initial={{ stripeAccountId: ctx.host.stripeAccountId }}
        />
      </div>
    </AppShell>
  );
}
