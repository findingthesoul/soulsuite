import Link from "next/link";
import { Calendar, List, Grid3x3, CalendarDays } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { BookingDateTime } from "./client";
import { WeekGrid } from "./week-grid";
import { MonthGrid } from "./month-grid";
import { PersistSearchParams } from "@/components/persist-search-params";
import { PrefetchLink } from "@/components/prefetch-link";
import { AltLocationButton } from "./alt-location-button";

type RangeFilter = "upcoming" | "past" | "all";
type ScopeFilter = "all" | "personal" | string; // string = project id
type ViewMode = "list" | "week" | "month";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    scope?: string;
    view?: string;
    weekOf?: string;
    monthOf?: string;
  }>;
}) {
  const ctx = await getPageContextOrRedirect();
  const sp = await searchParams;

  const view: ViewMode =
    sp.view === "week" ? "week" : sp.view === "month" ? "month" : "list";
  const range: RangeFilter = sp.range === "past" ? "past" : sp.range === "all" ? "all" : "upcoming";
  const scope: ScopeFilter = sp.scope ?? "all";

  const weekOfStart = parseDayUtc(sp.weekOf) ?? mondayOfCurrentWeek();
  const weekOfEnd = new Date(weekOfStart.getTime() + 7 * 24 * 3600 * 1000);

  // For month view: always pin to the 1st of the month at UTC midnight, plus a window that
  // covers the 6-week grid (~42 days starting from the Monday before the 1st).
  const monthOfStart = parseDayUtc(sp.monthOf) ?? firstOfCurrentMonth();
  const monthGridStart = mondayOnOrBefore(monthOfStart);
  const monthGridEnd = new Date(monthGridStart.getTime() + 42 * 24 * 3600 * 1000);

  const baseScopeWhere = {
    hostId: ctx.host.id,
    ...(scope === "personal" && { projectId: null }),
    ...(scope !== "all" && scope !== "personal" && { projectId: scope }),
  };

  const now = new Date();
  // Two independent queries — run in parallel. `select` only the fields the grid renders
  // instead of `include` (which pulls ~30 columns × 1000 rows of meetingType + project data
  // we throw away). On a busy month this dropped query+deserialise time by ~10x.
  const [memberships, bookings] = await Promise.all([
    prisma.projectMember.findMany({
      where: { hostId: ctx.host.id },
      include: { project: { select: { id: true, slug: true, name: true, isActive: true } } },
      orderBy: { addedAt: "asc" },
    }),
    prisma.booking.findMany({
      where:
        view === "week"
          ? { ...baseScopeWhere, startsAt: { gte: weekOfStart, lt: weekOfEnd } }
          : view === "month"
            ? { ...baseScopeWhere, startsAt: { gte: monthGridStart, lt: monthGridEnd } }
            : {
                ...baseScopeWhere,
                ...(range === "upcoming" && { startsAt: { gte: now } }),
                ...(range === "past" && { startsAt: { lt: now } }),
              },
      select: {
        id: true,
        hostId: true,
        startsAt: true,
        endsAt: true,
        inviteeName: true,
        status: true,
        alternativeLocation: true,
        conferencingProvider: true,
        meetUrl: true,
        paymentMethod: true,
        paymentStatus: true,
        meetingType: {
          select: { slug: true, name: true, defaultLocation: true, priceCents: true, priceCurrency: true },
        },
        project: { select: { slug: true, name: true } },
      },
      orderBy: { startsAt: range === "past" && view === "list" ? "desc" : "asc" },
      // 200 list / 200 week (more than enough for 7 days) / 300 month (covers ~6 weeks of
      // dense schedules). Date-bounded queries already cap the worst case via the index.
      take: view === "list" ? 200 : view === "week" ? 200 : 300,
    }),
  ]);

  return (
    <AppShell {...shellProps(ctx)}>
      <PersistSearchParams keys={["view", "range", "scope"]} storageKey="soul-suite-bookings-view" />
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
            <p className="text-sm text-muted-foreground">Everything booked with you.</p>
          </div>
          <ViewToggle
            view={view}
            range={range}
            scope={scope}
            weekOf={sp.weekOf}
            monthOf={sp.monthOf}
          />
        </header>

        <Filters
          view={view}
          range={range}
          scope={scope}
          weekOfStart={weekOfStart}
          monthOfStart={monthOfStart}
          memberships={memberships.map((m) => m.project)}
        />

        {view === "week" ? (
          <WeekGrid
            bookings={bookings.map((b) => bookingForGrid(b, ctx.host.slug))}
            weekOfStart={weekOfStart.toISOString()}
            timezone={ctx.host.timezone}
          />
        ) : view === "month" ? (
          <MonthGrid
            bookings={bookings.map((b) => bookingForGrid(b, ctx.host.slug))}
            monthOf={ymd(monthOfStart)}
            gridStart={monthGridStart.toISOString()}
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
                const isHostOwn = b.hostId === ctx.host.id;
                const isUpcoming = b.startsAt.getTime() >= now.getTime();
                const showAlt = isHostOwn && isUpcoming && b.status !== "CANCELLED";
                // Hint shown in the dialog: the original (non-overridden) location source.
                const altHint =
                  b.conferencingProvider === "IN_PERSON"
                    ? b.meetingType.defaultLocation
                    : b.meetUrl;
                return (
                  <li key={b.id} className="flex items-center gap-3 hover:bg-surface-muted transition-colors">
                    <PrefetchLink
                      href={href}
                      className="flex items-center justify-between gap-4 px-4 py-3 flex-1 min-w-0"
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        <PaymentPill
                          paymentMethod={b.paymentMethod}
                          paymentStatus={b.paymentStatus}
                          priceCents={b.meetingType.priceCents}
                          priceCurrency={b.meetingType.priceCurrency}
                        />
                        <StatusPill status={b.status} />
                      </div>
                    </PrefetchLink>
                    {showAlt && (
                      <div className="pr-3">
                        <AltLocationButton
                          bookingId={b.id}
                          initial={b.alternativeLocation}
                          hint={altHint}
                        />
                      </div>
                    )}
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

function bookingForGrid(
  b: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    inviteeName: string;
    status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED";
    meetingType: { slug: string; name: string };
    project: { slug: string } | null;
  },
  hostSlug: string,
) {
  return {
    id: b.id,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    inviteeName: b.inviteeName,
    meetingTypeName: b.meetingType.name,
    status: b.status,
    href: `/${b.project ? b.project.slug : hostSlug}/${b.meetingType.slug}/confirmed/${b.id}`,
  };
}

// Payment pill — only renders when the meeting type was paid. Shows:
//   PAID                  (Stripe payment captured)
//   PAYMENT PENDING       (Stripe checkout in flight, not yet captured)
//   INVOICE · PENDING     (invoice not yet sent)
//   INVOICE · SENT        (host marked as invoiced)
//   INVOICE · PAID        (host marked the invoice paid)
//   FAILED / REFUNDED     (terminal payment states)
// Free MTs and untyped non-paid bookings render nothing.
function PaymentPill({
  paymentMethod,
  paymentStatus,
  priceCents,
  priceCurrency,
}: {
  paymentMethod: "STRIPE" | "INVOICE" | "ADYEN";
  paymentStatus: "NOT_REQUIRED" | "PENDING" | "PAID" | "REFUNDED" | "FAILED" | "INVOICE_PENDING" | "INVOICE_SENT";
  priceCents: number | null;
  priceCurrency: string | null;
}) {
  if (paymentStatus === "NOT_REQUIRED") return null;
  const amount =
    priceCents != null && priceCurrency
      ? new Intl.NumberFormat("en-GB", { style: "currency", currency: priceCurrency.toUpperCase() }).format(priceCents / 100)
      : null;
  let label: string;
  let styles: string;
  if (paymentMethod === "INVOICE") {
    if (paymentStatus === "INVOICE_PENDING") {
      label = "Invoice · pending";
      styles = "bg-surface-muted text-muted-foreground";
    } else if (paymentStatus === "INVOICE_SENT") {
      label = "Invoice · sent";
      styles = "bg-foreground/10 text-foreground";
    } else if (paymentStatus === "PAID") {
      label = "Invoice · paid";
      styles = "bg-foreground text-background";
    } else {
      label = "Invoice";
      styles = "bg-surface-muted text-muted-foreground";
    }
  } else {
    if (paymentStatus === "PAID") {
      label = "Paid";
      styles = "bg-foreground text-background";
    } else if (paymentStatus === "PENDING") {
      label = "Payment pending";
      styles = "bg-surface-muted text-muted-foreground";
    } else if (paymentStatus === "REFUNDED") {
      label = "Refunded";
      styles = "bg-surface-muted text-muted-foreground";
    } else if (paymentStatus === "FAILED") {
      label = "Payment failed";
      styles = "bg-destructive/10 text-destructive";
    } else {
      return null;
    }
  }
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${styles}`}
      title={amount ?? undefined}
    >
      {label}
    </span>
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
  monthOf,
}: {
  view: ViewMode;
  range: RangeFilter;
  scope: ScopeFilter;
  weekOf?: string;
  monthOf?: string;
}) {
  function urlFor(target: ViewMode) {
    const params = new URLSearchParams();
    if (target !== "list") params.set("view", target);
    if (scope !== "all") params.set("scope", scope);
    if (target === "list" && range !== "upcoming") params.set("range", range);
    if (target === "week" && weekOf) params.set("weekOf", weekOf);
    if (target === "month" && monthOf) params.set("monthOf", monthOf);
    const qs = params.toString();
    return qs ? `/dashboard/bookings?${qs}` : "/dashboard/bookings";
  }
  function btn(active: boolean) {
    return `flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ${
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
    }`;
  }
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      <Link href={urlFor("list")} className={btn(view === "list")}>
        <List className="h-3.5 w-3.5" />
        List
      </Link>
      <Link href={urlFor("week")} className={btn(view === "week")}>
        <Grid3x3 className="h-3.5 w-3.5" />
        Week
      </Link>
      <Link href={urlFor("month")} className={btn(view === "month")}>
        <CalendarDays className="h-3.5 w-3.5" />
        Month
      </Link>
    </div>
  );
}

function Filters({
  view,
  range,
  scope,
  weekOfStart,
  monthOfStart,
  memberships,
}: {
  view: ViewMode;
  range: RangeFilter;
  scope: ScopeFilter;
  weekOfStart: Date;
  monthOfStart: Date;
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
  function build(next: { range?: string; scope?: string; weekOf?: string; monthOf?: string }) {
    const params = new URLSearchParams();
    if (view !== "list") params.set("view", view);
    const r = next.range ?? range;
    const s = next.scope ?? scope;
    if (view === "list" && r !== "upcoming") params.set("range", r);
    if (s !== "all") params.set("scope", s);
    if (view === "week" && next.weekOf) params.set("weekOf", next.weekOf);
    if (view === "month" && next.monthOf) params.set("monthOf", next.monthOf);
    const qs = params.toString();
    return qs ? `/dashboard/bookings?${qs}` : "/dashboard/bookings";
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {view === "list" && (
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
      )}
      {view === "week" && (
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
          <span className="ml-2 text-xs text-muted-foreground">Week of {ymd(weekOfStart)}</span>
        </div>
      )}
      {view === "month" && (
        <div className="flex items-center gap-1.5">
          <Link
            href={build({ monthOf: ymd(addMonths(monthOfStart, -1)) })}
            className={pillClass(false)}
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link href={build({ monthOf: undefined })} className={pillClass(false)}>
            This month
          </Link>
          <Link
            href={build({ monthOf: ymd(addMonths(monthOfStart, 1)) })}
            className={pillClass(false)}
            aria-label="Next month"
          >
            →
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">{formatMonthHeader(monthOfStart)}</span>
        </div>
      )}
      <span className="text-subtle-foreground text-xs px-1">·</span>
      <ScopeDropdown scope={scope} memberships={memberships} build={build} />
    </div>
  );
}

// Scope picker — dropdown so the bar stays compact even with many teams. Server-rendered
// <select> + form so a change submits a GET to the same page with the new ?scope=.
function ScopeDropdown({
  scope,
  memberships,
  build,
}: {
  scope: ScopeFilter;
  memberships: { id: string; name: string; slug: string }[];
  build: (next: { scope?: string }) => string;
}) {
  const options: { value: string; label: string }[] = [
    { value: "all", label: "All scopes" },
    { value: "personal", label: "Personal" },
    ...memberships.map((p) => ({ value: p.id, label: p.name })),
  ];
  // Render every option as a <Link> in a <details> menu — accessible without JS, no client deps.
  const currentLabel = options.find((o) => o.value === scope)?.label ?? "All scopes";
  return (
    <details className="relative inline-block">
      <summary className="list-none rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5">
        {currentLabel}
        <span aria-hidden className="text-subtle-foreground">▾</span>
      </summary>
      <div className="absolute z-10 mt-1 min-w-[160px] rounded-md border border-border bg-surface shadow-md p-1">
        {options.map((o) => (
          <Link
            key={o.value}
            href={build({ scope: o.value })}
            className={`block rounded-sm px-3 py-1.5 text-sm ${
              scope === o.value
                ? "bg-surface-muted text-foreground"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────

function parseDayUtc(s: string | undefined): Date | null {
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
  const dow = now.getUTCDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + offsetToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function firstOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function mondayOnOrBefore(d: Date): Date {
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + offset);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function formatMonthHeader(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(d);
}
