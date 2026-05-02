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

  // Pull all contacts in the workspace + their last booking timestamp. Aggregating last-meeting
  // per-email in a single round-trip keeps the page fast even for large directories — the
  // heavy lifting (per-contact past/upcoming) is deferred to the detail page.
  const contacts = await prisma.contact.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { name: "asc" },
  });

  const emails = contacts.map((c) => c.email);
  const lastByEmail = new Map<string, Date>();
  if (emails.length > 0) {
    const grouped = await prisma.booking.groupBy({
      by: ["inviteeEmail"],
      where: { inviteeEmail: { in: emails } },
      _max: { startsAt: true },
    });
    for (const g of grouped) {
      if (g._max.startsAt) lastByEmail.set(g.inviteeEmail.toLowerCase(), g._max.startsAt);
    }
  }

  const rows: ContactRow[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company,
    lastMeetingAt: (lastByEmail.get(c.email.toLowerCase()) ?? null)?.toISOString() ?? null,
  }));

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People who&apos;ve booked with anyone in your workspace.
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
