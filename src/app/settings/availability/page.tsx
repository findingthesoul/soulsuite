import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { WorkingHoursForm } from "@/app/onboarding/working-hours/form";

export default async function AvailabilitySettingsPage() {
  const ctx = await getPageContextOrRedirect();
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
          <p className="text-sm text-muted-foreground">Timezone and weekly working hours.</p>
        </header>
        <WorkingHoursForm
          variant="edit"
          initial={{
            timezone: ctx.host.timezone,
            workingHours: ctx.host.workingHours as never,
          }}
        />
      </div>
    </AppShell>
  );
}
