import Link from "next/link";
import { Plus, Vote } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function PollsListPage() {
  const ctx = await getPageContextOrRedirect();
  const polls = await prisma.poll.findMany({
    where: { ownerHostId: ctx.host.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Polls</h1>
            <p className="text-sm text-muted-foreground">
              Doodle-style polls for finding a time across multiple invitees.
            </p>
          </div>
          <Link href="/dashboard/polls/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New poll
          </Link>
        </header>

        {polls.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Vote className="mx-auto mb-2 h-5 w-5 text-subtle-foreground" />
              No polls yet.
            </div>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {polls.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/polls/${p.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted transition-colors"
                  >
                    <div className="min-w-0 flex-1">
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
