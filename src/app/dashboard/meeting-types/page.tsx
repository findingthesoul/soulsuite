import Link from "next/link";
import { Plus } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { publicEnv } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function MeetingTypesPage() {
  const ctx = await getPageContextOrRedirect();
  const meetingTypes = await prisma.meetingType.findMany({
    where: { scope: "PERSONAL", hostId: ctx.host.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Meeting types</h1>
            <p className="text-sm text-muted-foreground">
              Personal meeting types — your bookable links live at{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
                /{ctx.host.slug}/&lt;slug&gt;
              </code>
              .
            </p>
          </div>
          <Link href="/dashboard/meeting-types/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New
          </Link>
        </header>

        {meetingTypes.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No meeting types yet.</p>
              <Link href="/dashboard/meeting-types/new" className={buttonVariants()}>
                Create your first
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {meetingTypes.map((mt) => {
                const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/${ctx.host.slug}/${mt.slug}`;
                return (
                  <li key={mt.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/meeting-types/${mt.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {mt.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {mt.durationMinutes} min · {url}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/${ctx.host.slug}/${mt.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground underline hover:text-foreground"
                      >
                        Open booking page ↗
                      </a>
                    </div>
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
