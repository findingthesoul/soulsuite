import Link from "next/link";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { publicEnv } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NewSchedulingMenu } from "@/components/new-scheduling-menu";
import { CopyLinkButton, OpenBookingLink } from "@/components/copy-link-button";

export default async function MeetingTypesPage() {
  const ctx = await getPageContextOrRedirect();
  const [meetingTypes, oneOffMeetings, polls] = await Promise.all([
    prisma.meetingType.findMany({
      where: { scope: "PERSONAL", hostId: ctx.host.id, isActive: true, isOneOff: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.meetingType.findMany({
      where: { scope: "PERSONAL", hostId: ctx.host.id, isActive: true, isOneOff: true },
      include: { oneOffSlots: { select: { id: true, bookedBookingId: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.poll.findMany({
      where: { ownerHostId: ctx.host.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const hasNothing = meetingTypes.length === 0 && polls.length === 0 && oneOffMeetings.length === 0;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Personal scheduling</h1>
            <p className="text-sm text-muted-foreground">
              Your personal bookable links live at{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
                /{ctx.host.slug}/&lt;slug&gt;
              </code>
              .
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/meeting-types/one-off/new"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              New one-off
            </Link>
            <NewSchedulingMenu context="personal" />
          </div>
        </header>

        {hasNothing ? (
          <Card className="border-dashed">
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
              <Link href="/dashboard/meeting-types/new" className={buttonVariants()}>
                Create your first
              </Link>
            </div>
          </Card>
        ) : (
          <>
            {meetingTypes.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
                  Meeting types ({meetingTypes.length})
                </h2>
                <Card>
                  <ul className="divide-y divide-border">
                    {meetingTypes.map((mt) => {
                      const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/${ctx.host.slug}/${mt.slug}`;
                      return (
                        <li key={mt.id}>
                          <Link
                            href={`/dashboard/meeting-types/${mt.id}`}
                            className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{mt.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {mt.durationMinutes} min · {url}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <CopyLinkButton url={`/${ctx.host.slug}/${mt.slug}`} />
                              <OpenBookingLink href={`/${ctx.host.slug}/${mt.slug}`} />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            )}

            {oneOffMeetings.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
                  One-off meetings ({oneOffMeetings.length})
                </h2>
                <Card>
                  <ul className="divide-y divide-border">
                    {oneOffMeetings.map((mt) => {
                      const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/${ctx.host.slug}/${mt.slug}`;
                      const total = mt.oneOffSlots.length;
                      const claimed = mt.oneOffSlots.filter((s) => s.bookedBookingId).length;
                      return (
                        <li key={mt.id}>
                          <Link
                            href={`/dashboard/meeting-types/${mt.id}`}
                            className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{mt.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {claimed}/{total} slots booked · {url}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <CopyLinkButton url={`/${ctx.host.slug}/${mt.slug}`} />
                              <OpenBookingLink href={`/${ctx.host.slug}/${mt.slug}`} />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            )}

            {polls.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">
                  Polls ({polls.length})
                </h2>
                <Card>
                  <ul className="divide-y divide-border">
                    {polls.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/dashboard/polls/${p.id}`}
                          className="flex items-center justify-between gap-4 p-4 hover:bg-surface-muted transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.durationMinutes} min · {p.inviteeEmails.length} invitees
                            </p>
                          </div>
                          <PollStatusPill status={p.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function PollStatusPill({ status }: { status: "OPEN" | "FINALIZED" | "CANCELLED" }) {
  const styles =
    status === "FINALIZED"
      ? "bg-foreground text-background"
      : status === "CANCELLED"
        ? "bg-destructive/10 text-destructive"
        : "bg-surface-muted text-foreground";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${styles}`}>
      {status.toLowerCase()}
    </span>
  );
}
