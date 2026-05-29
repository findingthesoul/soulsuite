import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { MeetingTypeForm } from "../form";
import { CopyLinkButton, OpenBookingLink } from "@/components/copy-link-button";
import type { IntakeField } from "@/lib/intake";

export default async function EditMeetingTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPageContextOrRedirect();

  const [mt, calendars, membership] = await Promise.all([
    prisma.meetingType.findUnique({ where: { id }, include: { intakeForm: true } }),
    prisma.calendar.findMany({
      where: { hostId: ctx.host.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workspaceMember.findFirst({
      where: { hostId: ctx.host.id },
      include: { workspace: true },
    }),
  ]);
  if (!mt || mt.scope !== "PERSONAL" || mt.hostId !== ctx.host.id) notFound();
  const intakeFields = (mt.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/meeting-types" className="hover:text-foreground">Personal</Link>
            {" › "}
            <span className="text-foreground">{mt.name}</span>
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <CopyLinkButton url={`/${ctx.host.slug}/${mt.slug}`} />
            <OpenBookingLink href={`/${ctx.host.slug}/${mt.slug}`} label="Open ↗" />
          </div>
        </div>
        <MeetingTypeForm
          hostSlug={ctx.host.slug}
          hostHasZoom={!!ctx.host.zoomRefreshToken}
          hostHasStripe={!!ctx.host.stripeAccountId}
          hostHasPersonalZoomRoom={!!ctx.host.personalZoomRoomUrl}
          hostHasPersonalTeamsRoom={!!ctx.host.personalTeamsRoomUrl}
          workspaceHasZoomRoom={!!membership?.workspace.sharedZoomRoomUrl}
          workspaceHasTeamsRoom={!!membership?.workspace.sharedTeamsRoomUrl}
          hostRequireApprovalDefault={ctx.host.requireApprovalDefault}
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
            conferencingProvider: mt.conferencingProvider as never,
            defaultLocation: mt.defaultLocation,
            maxInvitees: mt.maxInvitees,
            workingHoursOverride: mt.workingHoursOverride as never,
            priceCents: mt.priceCents,
            priceCurrency: mt.priceCurrency,
            paymentMethod: mt.paymentMethod,
            requireApproval: mt.requireApproval,
          }}
        />
      </div>
    </AppShell>
  );
}
