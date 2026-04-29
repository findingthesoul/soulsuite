import Link from "next/link";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { CalendarPickerForm } from "@/app/onboarding/calendars/form";

// Mirrors the onboarding calendar picker but in "edit" variant — read-only by default,
// Edit unlocks, Save/Cancel commits/reverts. Same /api/onboarding/calendars endpoint.
export default async function CalendarsSettingsPage() {
  const ctx = await getPageContextOrRedirect();

  if (!ctx.host.googleRefreshToken) {
    return <ReauthRequired ctx={ctx} message="We don't have a Google refresh token yet. Sign in again to grant calendar access." />;
  }

  let calendars: { id: string; summary: string; primary: boolean; accessRole: string | null }[] = [];
  try {
    const cal = calendarFor(ctx.host.googleRefreshToken);
    const res = await cal.calendarList.list({ maxResults: 100 });
    calendars = (res.data.items ?? []).map((c) => ({
      id: c.id ?? "",
      summary: c.summaryOverride ?? c.summary ?? c.id ?? "(unnamed)",
      primary: Boolean(c.primary),
      accessRole: c.accessRole ?? null,
    }));
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host.update({ where: { id: ctx.host.id }, data: { googleRefreshToken: null } });
      return <ReauthRequired ctx={ctx} message="Your Google credentials were revoked or expired. Sign in again to reconnect." />;
    }
    throw err;
  }

  const saved = await prisma.calendar.findMany({ where: { hostId: ctx.host.id } });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendars</h1>
          <p className="text-sm text-muted-foreground">
            Pick which Google calendars block availability and where new bookings get created.
          </p>
        </header>
        <CalendarPickerForm
          variant="edit"
          calendars={calendars}
          saved={saved.map((c) => ({ googleCalendarId: c.googleCalendarId, role: c.role }))}
        />
      </div>
    </AppShell>
  );
}

function ReauthRequired({
  ctx,
  message,
}: {
  ctx: Awaited<ReturnType<typeof getPageContextOrRedirect>>;
  message: string;
}) {
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reconnect Google</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/auth/signin" className={buttonVariants()}>
          Reconnect
        </Link>
      </div>
    </AppShell>
  );
}
