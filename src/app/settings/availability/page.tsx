import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { WorkingHoursForm } from "@/app/onboarding/working-hours/form";

export default async function AvailabilitySettingsPage() {
  const ctx = await getPageContextOrRedirect();
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl">
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
