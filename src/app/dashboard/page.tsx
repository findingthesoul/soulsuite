import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, ArrowRight } from "lucide-react";
import type { Host } from "@prisma/client";
import { hostHasCompletedOnboarding } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { SkeletonRow } from "@/components/skeletons";
import { BookingDateTime } from "./bookings/client";
import { PrefetchLink } from "@/components/prefetch-link";
import { CopyLinkButton, OpenBookingLink } from "@/components/copy-link-button";

export default async function DashboardPage() {
  const ctx = await getPageContextOrRedirect();
  if (!(await hostHasCompletedOnboarding(ctx.host))) redirect("/onboarding/calendars");

  const firstName = ctx.host.name.split(" ")[0];
  const now = new Date();

  // Capture the previous "seen" timestamp before bumping it — the sections compare every
  // booking's createdAt against this to decide whether to show a "new" badge. The update fires
  // in the background so it doesn't block the first paint; the next visit picks up the new
  // timestamp regardless of what races. Null on first ever visit → no badges that round.
  const previousSeenAt = ctx.host.dashboardSeenAt;
  void prisma.host.update({
    where: { id: ctx.host.id },
    data: { dashboardSeenAt: now },
  }).catch(() => undefined);

  // Each section streams independently via Suspense — header renders instantly, then
  // Today / Next up / Open polls fill in as their queries land. With this + the loading.tsx
  // skeleton from the parent boundary, navigating onto /dashboard feels native-app-fast
  // even on a slow first byte. Today + Next up sit side-by-side on md+ for faster skim.
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {firstName}</h1>
          <p className="text-sm text-muted-foreground">{niceDateLong(now)}</p>
        </header>

        <Suspense fallback={null}>
          <QuickLinksSection host={ctx.host} />
        </Suspense>

        <div className="grid gap-6 md:grid-cols-2">
          <Suspense fallback={<SectionSkeleton title="Today" />}>
            <TodaySection host={ctx.host} previousSeenAt={previousSeenAt} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton title="Next up" />}>
            <UpcomingSection host={ctx.host} previousSeenAt={previousSeenAt} />
          </Suspense>
        </div>

        <Suspense fallback={null}>
          <OpenPollsSection host={ctx.host} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function TodaySection({ host, previousSeenAt }: { host: Host; previousSeenAt: Date | null }) {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setUTCHours(23, 59, 59, 999);
  const bookings = await prisma.booking.findMany({
    where: { hostId: host.id, status: { not: "CANCELLED" }, startsAt: { gte: now, lte: todayEnd } },
    select: bookingRowSelect,
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  return (
    <section className="space-y-3">
      <SectionHeader title="Today" count={bookings.length} href="/dashboard/bookings" />
      {bookings.length === 0 ? (
        <Card>
          <div className="p-6 text-sm text-muted-foreground">Nothing on the calendar today.</div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {bookings.map((b) => (
              <BookingRow
                key={b.id}
                href={hrefFor(b, host.slug)}
                name={b.inviteeName}
                meetingType={b.meetingType.name}
                projectName={b.project?.name}
                startsAt={b.startsAt.toISOString()}
                endsAt={b.endsAt.toISOString()}
                isNew={isBookingNew(b.createdAt, previousSeenAt)}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

async function UpcomingSection({ host, previousSeenAt }: { host: Host; previousSeenAt: Date | null }) {
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  const bookings = await prisma.booking.findMany({
    where: { hostId: host.id, status: { not: "CANCELLED" }, startsAt: { gt: todayEnd } },
    select: bookingRowSelect,
    orderBy: { startsAt: "asc" },
    take: 5,
  });
  return (
    <section className="space-y-3">
      <SectionHeader title="Next up" count={bookings.length} href="/dashboard/bookings" />
      {bookings.length === 0 ? (
        <Card>
          <div className="p-6 text-sm text-muted-foreground">No upcoming bookings.</div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {bookings.map((b) => (
              <BookingRow
                key={b.id}
                href={hrefFor(b, host.slug)}
                name={b.inviteeName}
                meetingType={b.meetingType.name}
                projectName={b.project?.name}
                startsAt={b.startsAt.toISOString()}
                endsAt={b.endsAt.toISOString()}
                isNew={isBookingNew(b.createdAt, previousSeenAt)}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

async function OpenPollsSection({ host }: { host: Host }) {
  const polls = await prisma.poll.findMany({
    where: { ownerHostId: host.id, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (polls.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionHeader title="Open polls" count={polls.length} href="/dashboard/meeting-types" />
      <Card>
        <ul className="divide-y divide-border">
          {polls.map((p) => (
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
  );
}

async function QuickLinksSection({ host }: { host: Host }) {
  // "Most-booked" = bookings (any status) created in the last 90 days, grouped by
  // meetingTypeId. Group first to keep the working set small, then load metadata
  // for just the top 3 IDs in a single follow-up query — avoids N+1.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const grouped = await prisma.booking.groupBy({
    by: ["meetingTypeId"],
    where: {
      createdAt: { gte: cutoff },
      meetingType: {
        isActive: true,
        isOneOff: false,
        OR: [
          { scope: "PERSONAL", hostId: host.id },
          { scope: "PROJECT", assignedHostIds: { has: host.id } },
        ],
      },
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  if (grouped.length === 0) return null;

  // Sort: count desc, then most-recent booking desc (tie-break by recency); name comes
  // later once we've loaded MT rows. Take a slightly-larger window so we can do the
  // alphabetical tie-break with full metadata, then trim to 3.
  grouped.sort((a, b) => {
    if (b._count._all !== a._count._all) return b._count._all - a._count._all;
    const aT = a._max.createdAt?.getTime() ?? 0;
    const bT = b._max.createdAt?.getTime() ?? 0;
    return bT - aT;
  });

  const topIds = grouped.slice(0, 6).map((g) => g.meetingTypeId);
  const meetingTypes = await prisma.meetingType.findMany({
    where: { id: { in: topIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      durationMinutes: true,
      scope: true,
      hostId: true,
      project: { select: { slug: true, name: true } },
    },
  });
  const mtById = new Map(meetingTypes.map((mt) => [mt.id, mt]));

  // Re-rank by the original sort order, applying alphabetical tie-break for equal
  // (count, recency) pairs once we know the names.
  const ranked = grouped
    .map((g) => ({ g, mt: mtById.get(g.meetingTypeId) }))
    .filter((x): x is { g: (typeof grouped)[number]; mt: NonNullable<ReturnType<typeof mtById.get>> } => Boolean(x.mt))
    .sort((a, b) => {
      if (b.g._count._all !== a.g._count._all) return b.g._count._all - a.g._count._all;
      const aT = a.g._max.createdAt?.getTime() ?? 0;
      const bT = b.g._max.createdAt?.getTime() ?? 0;
      if (aT !== bT) return bT - aT;
      return a.mt.name.localeCompare(b.mt.name);
    })
    .slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Quick links</h2>
        <p className="text-xs text-muted-foreground">
          Your most-booked meeting types — copy and paste.
        </p>
      </div>
      <Card>
        <ul className="divide-y divide-border">
          {ranked.map(({ mt }) => {
            const ownerSlug = mt.project ? mt.project.slug : host.slug;
            const path = `/${ownerSlug}/${mt.slug}`;
            return (
              <li key={mt.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2 flex-wrap">
                    <span>{mt.name}</span>
                    {mt.project && (
                      <span className="text-xs uppercase tracking-wide text-subtle-foreground border border-border rounded-md px-1.5 py-0.5">
                        {mt.project.name}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {mt.durationMinutes} min · {path}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <CopyLinkButton url={path} />
                  <OpenBookingLink href={path} label="Open ↗" />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

const bookingRowSelect = {
  id: true,
  createdAt: true,
  startsAt: true,
  endsAt: true,
  inviteeName: true,
  meetingType: { select: { slug: true, name: true } },
  project: { select: { slug: true, name: true } },
} as const;

// "New" = created since the host's previous dashboard visit. First-ever visit (no prior
// timestamp) treats nothing as new — avoids painting the entire page red on day one.
function isBookingNew(createdAt: Date, previousSeenAt: Date | null): boolean {
  if (!previousSeenAt) return false;
  return createdAt.getTime() > previousSeenAt.getTime();
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">{title}</h2>
      <Card>
        <div className="divide-y divide-border">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </Card>
    </section>
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
  isNew,
}: {
  href: string;
  name: string;
  meetingType: string;
  projectName?: string;
  startsAt: string;
  endsAt: string;
  isNew?: boolean;
}) {
  return (
    <li>
      <PrefetchLink
        href={href}
        className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate flex items-center gap-2">
            {isNew && (
              <span
                className="inline-block h-2 w-2 rounded-full bg-primary shrink-0"
                aria-label="New booking"
                title="New since your last visit"
              />
            )}
            <span className="truncate">
              {name}
              <span className="text-muted-foreground font-normal"> · {meetingType}</span>
            </span>
            {isNew && (
              <span className="ml-auto rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium shrink-0">
                New
              </span>
            )}
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
