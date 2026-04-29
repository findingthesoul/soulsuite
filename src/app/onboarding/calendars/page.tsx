import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { prisma } from "@/lib/prisma";
import { getPageContextOrRedirect, shellProps, type PageContext } from "@/lib/page-context";
import { CalendarPickerForm } from "./form";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";

// Server-side fetch of the host's Google calendars + their currently saved selections.
// Hands both to the client form which posts back to /api/onboarding/calendars.
export default async function CalendarPickerPage() {
  const ctx = await getPageContextOrRedirect();
  if (!ctx.host.googleRefreshToken) {
    return (
      <ReauthRequired
        ctx={ctx}
        message="We don't have a Google refresh token for your account yet. Sign in again with the Google consent screen to grant calendar access."
      />
    );
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
      // Token revoked or expired — wipe the cached value so the user re-consents.
      await prisma.host.update({ where: { id: ctx.host.id }, data: { googleRefreshToken: null } });
      return (
        <ReauthRequired ctx={ctx} message="Your Google credentials were revoked or expired. Sign in again to reconnect." />
      );
    }
    throw err;
  }

  const saved = await prisma.calendar.findMany({ where: { hostId: ctx.host.id } });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pick your calendars</h1>
          <p className="text-sm text-muted-foreground">
            Conflict sources block you from being booked over an existing event. The write target is where new
            bookings get created.
          </p>
        </header>
        <CalendarPickerForm
          calendars={calendars}
          saved={saved.map((c) => ({ googleCalendarId: c.googleCalendarId, role: c.role }))}
        />
      </div>
    </AppShell>
  );
}

function ReauthRequired({ ctx, message }: { ctx: PageContext; message: string }) {
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reconnect Google</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <a href="/auth/signin" className={buttonVariants()}>
          Reconnect
        </a>
      </div>
    </AppShell>
  );
}
