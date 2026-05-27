import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { BookForm } from "./form";

// Host-initiated booking: the host picks a meeting type, slot, and invitee. Server fetches
// the list of MTs the host can book on (personal + project memberships) and hands it to the
// form. The slot picker re-validates server-side on submit via /api/host-bookings.

export default async function BookPage() {
  const ctx = await getPageContextOrRedirect();
  const host = ctx.host;

  // Meeting types the host can initiate from:
  //   - Personal MTs they own
  //   - Project MTs on projects where they're a member
  const projectMemberships = await prisma.projectMember.findMany({
    where: { hostId: host.id },
    select: { projectId: true },
  });
  const projectIds = projectMemberships.map((m) => m.projectId);

  const meetingTypes = await prisma.meetingType.findMany({
    where: {
      isActive: true,
      isOneOff: false,
      OR: [
        { scope: "PERSONAL", hostId: host.id },
        { scope: "PROJECT", projectId: { in: projectIds } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      durationMinutes: true,
      priceCents: true,
      priceCurrency: true,
      paymentMethod: true,
      requireApproval: true,
      maxInvitees: true,
      // maxAdvanceDays drives the slot-fetch window on the client. Without it the form would
      // always ask for 14 days even when the MT allows 60.
      maxAdvanceDays: true,
      scope: true,
      project: { select: { name: true } },
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });

  // Recent contacts as suggestions for the invitee field.
  const recentContacts = await prisma.contact.findMany({
    where: ctx.workspace ? { workspaceId: ctx.workspace.id } : { id: "none" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { email: true, name: true },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Book a meeting</h1>
          <p className="text-sm text-muted-foreground">
            You pick a meeting type, time, and invitee. For free meetings the calendar invite goes
            out immediately. For paid meetings the invitee gets a payment link first.
          </p>
        </header>
        <BookForm
          hostName={host.name}
          meetingTypes={meetingTypes.map((mt) => ({
            id: mt.id,
            label:
              mt.scope === "PROJECT" && mt.project
                ? `${mt.project.name} · ${mt.name}`
                : mt.name,
            durationMinutes: mt.durationMinutes,
            priceCents: mt.priceCents,
            priceCurrency: mt.priceCurrency,
            paymentMethod: mt.paymentMethod,
            maxInvitees: mt.maxInvitees,
            maxAdvanceDays: mt.maxAdvanceDays,
          }))}
          contactSuggestions={recentContacts.map((c) => ({
            email: c.email,
            name: c.name ?? c.email.split("@")[0],
          }))}
        />
      </div>
    </AppShell>
  );
}
