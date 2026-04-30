import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { MeetingTypeForm } from "../form";
import type { IntakeField } from "@/lib/intake";

export default async function EditMeetingTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPageContextOrRedirect();

  const [mt, calendars] = await Promise.all([
    prisma.meetingType.findUnique({ where: { id }, include: { intakeForm: true } }),
    prisma.calendar.findMany({
      where: { hostId: ctx.host.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!mt || mt.scope !== "PERSONAL" || mt.hostId !== ctx.host.id) notFound();
  const intakeFields = (mt.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit meeting type</h1>
          <p className="text-sm text-muted-foreground">
            Booking link: <code className="text-xs">/{ctx.host.slug}/{mt.slug}</code>
          </p>
        </header>
        <MeetingTypeForm
          hostSlug={ctx.host.slug}
          hostCalendars={calendars.map((c) => ({
            id: c.id,
            summary: c.summary ?? c.googleCalendarId,
            role: c.role,
          }))}
          initial={{
            id: mt.id,
            name: mt.name,
            slug: mt.slug,
            description: mt.description,
            durationMinutes: mt.durationMinutes,
            bufferBeforeMinutes: mt.bufferBeforeMinutes,
            bufferAfterMinutes: mt.bufferAfterMinutes,
            minNoticeMinutes: mt.minNoticeMinutes,
            maxAdvanceDays: mt.maxAdvanceDays,
            conflictCalendarIds: mt.conflictCalendarIds,
            intakeFields,
            isActive: mt.isActive,
          }}
        />
      </div>
    </AppShell>
  );
}
