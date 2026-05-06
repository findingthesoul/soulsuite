import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ContactDetailForm } from "./form";
import { ContactMeetingsList, type MeetingItem } from "./meetings-list";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPageContextOrRedirect();
  if (!ctx.workspace) redirect("/dashboard");

  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact || contact.workspaceId !== ctx.workspace.id) notFound();

  const now = new Date();
  // One query, partitioned in JS — saves the round-trips and keeps the three buckets ranked
  // consistently. Cap at 150 rows total; older history is reachable via /dashboard/bookings.
  const allBookings = await prisma.booking.findMany({
    where: { inviteeEmail: contact.email },
    orderBy: { startsAt: "desc" },
    take: 150,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      inviteeName: true,
      inviteeEmail: true,
      meetUrl: true,
      conferencingProvider: true,
      alternativeLocation: true,
      meetingType: { select: { name: true, slug: true, defaultLocation: true } },
      host: { select: { name: true, slug: true } },
      project: { select: { slug: true } },
    },
  });

  const upcoming: MeetingItem[] = [];
  const past: MeetingItem[] = [];
  const cancelled: MeetingItem[] = [];
  for (const b of allBookings) {
    const item: MeetingItem = {
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
      inviteeName: b.inviteeName,
      inviteeEmail: b.inviteeEmail,
      meetUrl: b.meetUrl,
      conferencingProvider: b.conferencingProvider,
      alternativeLocation: b.alternativeLocation,
      meetingTypeName: b.meetingType.name,
      meetingTypeSlug: b.meetingType.slug,
      defaultLocation: b.meetingType.defaultLocation,
      hostName: b.host.name,
      hostSlug: b.host.slug,
      projectSlug: b.project?.slug ?? null,
    };
    if (b.status === "CANCELLED") {
      cancelled.push(item);
    } else if (b.startsAt.getTime() >= now.getTime()) {
      upcoming.push(item);
    } else {
      past.push(item);
    }
  }
  // Upcoming wants asc (next first); past + cancelled stay desc (most-recent first).
  upcoming.reverse();

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <Link
          href="/dashboard/contacts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All contacts
        </Link>

        <ContactDetailForm
          initial={{
            id: contact.id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            jobTitle: contact.jobTitle,
            linkedinUrl: contact.linkedinUrl,
            location: contact.location,
            timeZone: contact.timeZone,
          }}
        />

        <ContactMeetingsList upcoming={upcoming} past={past} cancelled={cancelled} />
      </div>
    </AppShell>
  );
}
