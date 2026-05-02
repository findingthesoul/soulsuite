import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactDetailForm } from "./form";

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
  const [pastBookings, upcomingBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { inviteeEmail: contact.email, startsAt: { lt: now } },
      orderBy: { startsAt: "desc" },
      take: 50,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        meetingType: { select: { name: true } },
      },
    }),
    prisma.booking.findMany({
      where: { inviteeEmail: contact.email, startsAt: { gte: now }, status: "CONFIRMED" },
      orderBy: { startsAt: "asc" },
      take: 50,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        meetingType: { select: { name: true } },
      },
    }),
  ]);

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

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming meetings</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {upcomingBookings.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No upcoming meetings.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {upcomingBookings.map((b) => (
                    <li key={b.id} className="px-6 py-3">
                      <p className="text-sm font-medium text-foreground">{b.meetingType.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.startsAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Past meetings</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pastBookings.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No past meetings.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {pastBookings.map((b) => (
                    <li key={b.id} className="px-6 py-3">
                      <p className="text-sm font-medium text-foreground">{b.meetingType.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.startsAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
