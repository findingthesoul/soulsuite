import Link from "next/link";
import { Calendar, List, Grid3x3 } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { BookingDateTime } from "./client";
import { WeekGrid } from "./week-grid";

type RangeFilter = "upcoming" | "past" | "all";
type ScopeFilter = "all" | "personal" | string; // string = project id
type ViewMode = "list" | "week";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; scope?: string; view?: string; weekOf?: string }>;
}) {
  const ctx = await getPageContextOrRedirect();
  const sp = await searchParams;

  const view: ViewMode = sp.view === "week" ? "week" : "list";
  const range: RangeFilter = sp.range === "past" ? "past" : sp.range === "all" ? "all" : "upcoming";
  const scope: ScopeFilter = sp.scope ?? "all";

  // For week view: pin to a specific Monday (weekOf=YYYY-MM-DD), default to current week.
  const weekOfStart = parseWeekOf(sp.weekOf) ?? mondayOfCurrentWeek();
  const weekOfEnd = new Date(weekOfStart.getTime() + 7 * 24 * 3600 * 1000);

  const memberships = await prisma.projectMember.findMany({
    where: { hostId: ctx.host.id },
    include: { project: true },
    orderBy: { addedAt: "asc" },
  });

  const baseScopeWhere = {
    hostId: ctx.host.id,
    ...(scope === "personal" && { projectId: null }),
    ...(scope !== "all" && scope !== "personal" && { projectId: scope }),
  };

  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where:
      view === "week"
        ? { ...baseScopeWhere, startsAt: { gte: weekOfStart, lt: weekOfEnd } }
        : {
            ...baseScopeWhere,
            ...(range === "upcoming" && { startsAt: { gte: now } }),
            ...(range === "past" && { startsAt: { lt: now } }),
          },
    include: { meetingType: true, project: true },
    orderBy: { startsAt: range === "past" && view === "list" ? "desc" : "asc" },
    take: view === "week" ? 500 : 200,
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
            <p className="text-sm text-muted-foreground">Everything booked with you.</p>
          </div>
          <ViewToggle view={view} range={range} scope={scope} weekOf={sp.weekOf} />
        </header>

        <Filters
          view={view}
          range={range}
          scope={scope}
          weekOfStart={weekOfStart}
          memberships={memberships.map((m) => m.project)}
        />

        {view === "week" ? (
          <WeekGrid
            bookings={bookings.map((b) => ({
              id: b.id,
              startsAt: b.startsAt.toISOString(),
              endsAt: b.endsAt.toISOString(),
              inviteeName: b.inviteeName,
              meetingTypeName: b.meetingType.name,
              status: b.status,
              href: `/${b.project ? b.project.slug : ctx.host.slug}/${b.meetingType.slug}/confirmed/${b.id}`,
            }))}
            weekOfStart={weekOfStart.toISOString()}
            timezone={ctx.host.timezone}
          />
        ) : bookings.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Calendar className="mx-auto mb-2 h-5 w-5 text-subtle-foreground" />
              {range === "upcoming"
                ? "No upcoming bookings."
                : range === "past"
                  ? "No past bookings."
                  : "No bookings yet."}
            </div>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {bookings.map((b) => {
                const publicSlug = b.project ? b.project.slug : ctx.host.slug;
                const href = `/${publicSlug}/${b.meetingType.slug}/confirmed/${b.id}`;
                return (
                  <li key={b.id}>
                    <Link
                      href={href}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {b.inviteeName}
                          <span className="text-muted-foreground font-normal"> · {b.meetingType.name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <BookingDateTime
                            startsAt={b.startsAt.toISOString()}
                            endsAt={b.endsAt.toISOString()}
                          />
                          {b.project && <span className="ml-1.5">· {b.project.name}</span>}
                        </p>
                      </div>
                      <StatusPill status={b.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED" }) {
  const styles =
    status === "CANCELLED"
      ? "bg-destructive/10 text-destructive"
      : status === "RESCHEDULED"
        ? "bg-surface-muted text-foreground"
        : "bg-foreground text-background";
  const label = status === "RESCHEDULED" ? "rescheduled" : status === "CANCELLED" ? "cancelled" : "confirmed";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${styles}`}>
      {label}
    </span>
  );
}

function ViewToggle({
  view,
  range,
  scope,
  weekOf,
}: {
  view: ViewMode;
  range: RangeFilter;
  scope: ScopeFilter;
  weekOf?: string;
}) {
  function urlFor(target: ViewMode) {
    const params = new URLSearchParams();
    if (target === "week") params.set("view", "week");
    if (scope !== "all") params.set("scope", scope);
    if (target === "list" && range !== "upcoming") params.set("range", range);
    if (target === "week" && weekOf) params.set("weekOf", weekOf);
    const qs = params.toString();
    return qs ? `/dashboard/bookings?${qs}` : "/dashboard/bookings";
  }
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      <Link
        href={urlFor("list")}
        className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ${
          view === "list" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <List className="h-3.5 w-3.5" />
        List
      </Link>
      <Link
        href={urlFor("week")}
        className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ${
          view === "week" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        Week
      </Link>
    </div>
  );
}

function Filters({
  view,
  range,
  scope,
  weekOfStart,
  memberships,
}: {
  view: ViewMode;
  range: RangeFilter;
  scope: ScopeFilter;
  weekOfStart: Date;
  memberships: { id: string; name: string; slug: string }[];
}) {
  function pillClass(active: boolean) {
    return [
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      active
        ? "bg-foreground text-background"
        : "border border-border bg-surface text-muted-foreground hover:text-foreground",
    ].join(" ");
  }
  function build(next: { range?: string; scope?: string; weekOf?: string }) {
    const params = new URLSearchParams();
    if (view === "week") params.set("view", "week");
    const r = next.range ?? range;
    const s = next.scope ?? scope;
    const w = next.weekOf;
    if (view === "list" && r !== "upcoming") params.set("range", r);
    if (s !== "all") params.set("scope", s);
    if (view === "week" && w) params.set("weekOf", w);
    const qs = params.toString();
    return qs ? `/dashboard/bookings?${qs}` : "/dashboard/bookings";
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {view === "list" ? (
        <div className="flex items-center gap-1.5">
          <Link href={build({ range: "upcoming" })} className={pillClass(range === "upcoming")}>
            Upcoming
          </Link>
          <Link href={build({ range: "past" })} className={pillClass(range === "past")}>
            Past
          </Link>
          <Link href={build({ range: "all" })} className={pillClass(range === "all")}>
            All
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Link
            href={build({ weekOf: ymd(addDays(weekOfStart, -7)) })}
            className={pillClass(false)}
            aria-label="Previous week"
          >
            ←
          </Link>
          <Link href={build({ weekOf: undefined })} className={pillClass(false)}>
            This week
          </Link>
          <Link
            href={build({ weekOf: ymd(addDays(weekOfStart, 7)) })}
            className={pillClass(false)}
            aria-label="Next week"
          >
            →
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">
            Week of {ymd(weekOfStart)}
          </span>
        </div>
      )}
      <span className="text-subtle-foreground text-xs px-1">·</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={build({ scope: "all" })} className={pillClass(scope === "all")}>
          All scopes
        </Link>
        <Link href={build({ scope: "personal" })} className={pillClass(scope === "personal")}>
          Personal
        </Link>
        {memberships.map((p) => (
          <Link key={p.id} href={build({ scope: p.id })} className={pillClass(scope === p.id)}>
            {p.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────

function parseWeekOf(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0));
  if (isNaN(date.getTime())) return null;
  return date;
}

function mondayOfCurrentWeek(): Date {
  const now = new Date();
  // Use UTC: anchor "Monday" in UTC. Display TZ math happens in WeekGrid client-side.
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow; // Sun→-6, Mon→0, Tue→-1, ...
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + offsetToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
