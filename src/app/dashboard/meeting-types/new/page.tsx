import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { MeetingTypeForm } from "../form";

export default async function NewMeetingTypePage() {
  const ctx = await getPageContextOrRedirect();
  const calendars = await prisma.calendar.findMany({
    where: { hostId: ctx.host.id },
    orderBy: { createdAt: "asc" },
  });
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New meeting type</h1>
          <p className="text-sm text-muted-foreground">
            Bookable at <code className="text-xs">/{ctx.host.slug}/&lt;slug&gt;</code> once saved.
          </p>
        </header>
        <MeetingTypeForm
          hostSlug={ctx.host.slug}
          hostHasZoom={!!ctx.host.zoomRefreshToken}
          hostHasStripe={!!ctx.host.stripeAccountId}
          hostHasPersonalRoom={!!ctx.host.personalRoomUrl}
          hostCalendars={calendars.map((c) => ({
            id: c.id,
            summary: c.summary ?? c.googleCalendarId,
            role: c.role,
          }))}
        />
      </div>
    </AppShell>
  );
}
