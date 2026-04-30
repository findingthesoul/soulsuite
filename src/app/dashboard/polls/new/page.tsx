import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { NewPollForm } from "./form";

export default async function NewPollPage() {
  const ctx = await getPageContextOrRedirect();
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New poll</h1>
          <p className="text-sm text-muted-foreground">
            Propose a few times, send each invitee a magic link, finalize once everyone&apos;s voted.
          </p>
        </header>
        <NewPollForm />
      </div>
    </AppShell>
  );
}
