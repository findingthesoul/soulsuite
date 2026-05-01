import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, ArrowRight } from "lucide-react";
import { hostHasCompletedOnboarding } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { BookingDateTime } from "./bookings/client";
import { PrefetchLink } from "@/components/prefetch-link";

export default async function DashboardPage() {
  const ctx = await getPageContextOrRedirect();
  if (!(await hostHasCompletedOnboarding(ctx.host))) redirect("/onboarding/calendars");

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setUTCHours(23, 59, 59, 999);

  const [todayBookings, upcomingBookings, openPolls] = await Promise.all([
    // Today: starting today, not yet ended.
    prisma.booking.findMany({
      where: {
        hostId: ctx.host.id,
        status: { not: "CANCELLED" },
        startsAt: { gte: now, lte: todayEnd },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        inviteeName: true,
        meetingType: { select: { slug: true, name: true } },
        project: { select: { slug: true, name: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 10,
    }),
    // Next up: from tomorrow onwards, top 5.
    prisma.booking.findMany({
      where: {
        hostId: ctx.host.id,
        status: { not: "CANCELLED" },
        startsAt: { gt: todayEnd },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        inviteeName: true,
        meetingType: { select: { slug: true, name: true } },
        project: { select: { slug: true, name: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
    }),
    // Polls awaiting your finalize decision.
    prisma.poll.findMany({
      where: { ownerHostId: ctx.host.id, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const firstName = ctx.host.name.split(" ")[0];

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {firstName}</h1>
          <p className="text-sm text-muted-foreground">{niceDateLong(now)}</p>
        </header>

        {/* Today */}
        <section className="space-y-3">
          <SectionHeader title="Today" count={todayBookings.length} href="/dashboard/bookings" />
          {todayBookings.length === 0 ? (
            <Card>
              <div className="p-6 text-sm text-muted-foreground">Nothing on the calendar today.</div>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {todayBookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    href={hrefFor(b, ctx.host.slug)}
                    name={b.inviteeName}
                    meetingType={b.meetingType.name}
                    projectName={b.project?.name}
                    startsAt={b.startsAt.toISOString()}
                    endsAt={b.endsAt.toISOString()}
                  />
                ))}
              </ul>
            </Card>
          )}
        </section>

        {/* Next up */}
        <section className="space-y-3">
          <SectionHeader title="Next up" count={upcomingBookings.length} href="/dashboard/bookings" />
          {upcomingBookings.length === 0 ? (
            <Card>
              <div className="p-6 text-sm text-muted-foreground">No upcoming bookings.</div>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {upcomingBookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    href={hrefFor(b, ctx.host.slug)}
                    name={b.inviteeName}
                    meetingType={b.meetingType.name}
                    projectName={b.project?.name}
                    startsAt={b.startsAt.toISOString()}
                    endsAt={b.endsAt.toISOString()}
                  />
                ))}
              </ul>
            </Card>
          )}
        </section>

        {/* Needs attention */}
        {openPolls.length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Open polls" count={openPolls.length} href="/dashboard/meeting-types" />
            <Card>
              <ul className="divide-y divide-border">
                {openPolls.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/dashboard/polls/${p.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.durationMinutes} min · {p.inviteeEmails.length} invitees
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function SectionHeader({ title, count, href }: { title: string; count: number; href: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
        {title}
        {count > 0 && <span className="ml-1 text-muted-foreground">({count})</span>}
      </h2>
      <Link href={href} className="text-xs text-muted-foreground underline hover:text-foreground">
        View all
      </Link>
    </div>
  );
}

function BookingRow({
  href,
  name,
  meetingType,
  projectName,
  startsAt,
  endsAt,
}: {
  href: string;
  name: string;
  meetingType: string;
  projectName?: string;
  startsAt: string;
  endsAt: string;
}) {
  return (
    <li>
      <PrefetchLink
        href={href}
        className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {name}
            <span className="text-muted-foreground font-normal"> · {meetingType}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            <BookingDateTime startsAt={startsAt} endsAt={endsAt} />
            {projectName && <span className="ml-1.5">· {projectName}</span>}
          </p>
        </div>
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
      </PrefetchLink>
    </li>
  );
}

function hrefFor(
  booking: { project: { slug: string } | null; meetingType: { slug: string }; id: string },
  hostSlug: string,
): string {
  const slug = booking.project ? booking.project.slug : hostSlug;
  return `/${slug}/${booking.meetingType.slug}/confirmed/${booking.id}`;
}

function niceDateLong(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}
