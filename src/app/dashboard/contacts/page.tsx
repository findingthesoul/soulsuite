import { redirect } from "next/navigation";
import { BookUser } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ContactsList, type ContactRow } from "./list";

export default async function ContactsPage() {
  const ctx = await getPageContextOrRedirect();
  if (!ctx.workspace) redirect("/dashboard");

  // Pull contacts + workspace members in parallel. Members surface here even before they've
  // been booked, so a host looking up a teammate doesn't have to wait for the first booking
  // to populate them. Members that already have a Contact row keep their Contact id (= still
  // clickable through to the detail page); member-only rows are listed without a link.
  const [contacts, workspaceMembers] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { name: "asc" },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: { host: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const memberByEmail = new Map(
    workspaceMembers.map((m) => [m.host.email.toLowerCase(), m.host]),
  );
  const allEmails = Array.from(
    new Set<string>([
      ...contacts.map((c) => c.email.toLowerCase()),
      ...workspaceMembers.map((m) => m.host.email.toLowerCase()),
    ]),
  );
  const lastByEmail = new Map<string, Date>();
  if (allEmails.length > 0) {
    const grouped = await prisma.booking.groupBy({
      by: ["inviteeEmail"],
      where: { inviteeEmail: { in: allEmails } },
      _max: { startsAt: true },
    });
    for (const g of grouped) {
      if (g._max.startsAt) lastByEmail.set(g.inviteeEmail.toLowerCase(), g._max.startsAt);
    }
  }

  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    const key = c.email.toLowerCase();
    seen.add(key);
    rows.push({
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      lastMeetingAt: (lastByEmail.get(key) ?? null)?.toISOString() ?? null,
      isMember: memberByEmail.has(key),
    });
  }
  for (const m of workspaceMembers) {
    const key = m.host.email.toLowerCase();
    if (seen.has(key)) continue;
    rows.push({
      id: null,
      name: m.host.name,
      email: m.host.email,
      company: null,
      lastMeetingAt: (lastByEmail.get(key) ?? null)?.toISOString() ?? null,
      isMember: true,
    });
  }
  rows.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Workspace members (always shown) and external people who&apos;ve booked with anyone
            on your team.
          </p>
        </header>

        {rows.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-10 text-center text-sm text-muted-foreground">
              <BookUser className="mx-auto mb-2 h-5 w-5 text-subtle-foreground" />
              No contacts yet — they&apos;ll appear here as you take bookings.
            </div>
          </Card>
        ) : (
          <ContactsList rows={rows} />
        )}
      </div>
    </AppShell>
  );
}
