import Link from "next/link";
import { Calendar } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { BookingDateTime } from "./client";

type RangeFilter = "upcoming" | "past" | "all";
type ScopeFilter = "all" | "personal" | string; // string = project id

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; scope?: string }>;
}) {
  const ctx = await getPageContextOrRedirect();
  const sp = await searchParams;

  const range: RangeFilter = sp.range === "past" ? "past" : sp.range === "all" ? "all" : "upcoming";
  const scope: ScopeFilter = sp.scope ?? "all";

  // Projects the host is a member of — surfaced as a filter dropdown.
  const memberships = await prisma.projectMember.findMany({
    where: { hostId: ctx.host.id },
    include: { project: true },
    orderBy: { addedAt: "asc" },
  });

  // Filter clauses. The list always scopes to bookings where the current host is the assigned
  // host — admins seeing a workspace-wide view comes later.
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: {
      hostId: ctx.host.id,
      ...(range === "upcoming" && { startsAt: { gte: now } }),
      ...(range === "past" && { startsAt: { lt: now } }),
      ...(scope === "personal" && { projectId: null }),
      ...(scope !== "all" && scope !== "personal" && { projectId: scope }),
    },
    include: { meetingType: true, project: true },
    orderBy: { startsAt: range === "past" ? "desc" : "asc" },
    take: 200,
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground">Everything booked with you, oldest first.</p>
        </header>

        <Filters range={range} scope={scope} memberships={memberships.map((m) => m.project)} />

        {bookings.length === 0 ? (
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

function Filters({
  range,
  scope,
  memberships,
}: {
  range: RangeFilter;
  scope: ScopeFilter;
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

  function build(next: { range?: string; scope?: string }) {
    const params = new URLSearchParams();
    const r = next.range ?? range;
    const s = next.scope ?? scope;
    if (r !== "upcoming") params.set("range", r);
    if (s !== "all") params.set("scope", s);
    const qs = params.toString();
    return qs ? `/dashboard/bookings?${qs}` : "/dashboard/bookings";
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
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
