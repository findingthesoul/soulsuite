import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { prisma } from "@/lib/prisma";
import { CalendarPickerForm } from "./form";

// Server-side fetch of the host's Google calendars + their currently saved selections.
// Hands both to the client form which posts back to /api/onboarding/calendars.
export default async function CalendarPickerPage() {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");
  if (!host.googleRefreshToken) {
    return (
      <ReauthRequired
        message="We don't have a Google refresh token for your account yet. Sign in again with the Google consent screen to grant calendar access."
      />
    );
  }

  let calendars: { id: string; summary: string; primary: boolean; accessRole: string | null }[] = [];
  try {
    const cal = calendarFor(host.googleRefreshToken);
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
      await prisma.host.update({ where: { id: host.id }, data: { googleRefreshToken: null } });
      return (
        <ReauthRequired message="Your Google credentials were revoked or expired. Sign in again to reconnect." />
      );
    }
    throw err;
  }

  const saved = await prisma.calendar.findMany({ where: { hostId: host.id } });

  return (
    <main className="min-h-screen p-6 md:p-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Pick your calendars</h1>
          <p className="text-sm text-neutral-500">
            Conflict sources block you from being booked over an existing event. The write target is where new
            bookings get created.
          </p>
        </header>
        <CalendarPickerForm
          calendars={calendars}
          saved={saved.map((c) => ({ googleCalendarId: c.googleCalendarId, role: c.role }))}
        />
      </div>
    </main>
  );
}

function ReauthRequired({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Reconnect Google</h1>
        <p className="text-sm text-neutral-600">{message}</p>
        <a
          href="/auth/signin"
          className="inline-block rounded-lg bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Reconnect
        </a>
      </div>
    </main>
  );
}
