import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { WorkingHoursForm } from "./form";
import { AppShell } from "@/components/app-shell";

export default async function WorkingHoursPage() {
  const ctx = await getPageContextOrRedirect();
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Working hours</h1>
          <p className="text-sm text-muted-foreground">
            Bookable windows in your local timezone. You can edit these any time from the dashboard.
          </p>
        </header>
        <WorkingHoursForm
          initial={{
            timezone: ctx.host.timezone,
            workingHours: ctx.host.workingHours as never,
          }}
        />
      </div>
    </AppShell>
  );
}
