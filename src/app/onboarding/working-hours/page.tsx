import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { WorkingHoursForm } from "./form";

export default async function WorkingHoursPage() {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");
  return (
    <main className="min-h-screen p-6 md:p-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Working hours</h1>
          <p className="text-sm text-neutral-500">
            Bookable windows in your local timezone. You can edit these any time from the dashboard.
          </p>
        </header>
        <WorkingHoursForm
          initial={{
            timezone: host.timezone,
            // The schema stores workingHours as JSON; the form normalises whatever we pass it.
            workingHours: host.workingHours as never,
          }}
        />
      </div>
    </main>
  );
}
