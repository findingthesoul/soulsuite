import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailDiagnosticsClient } from "./client";

// Super-admin email diagnostics. Three blocks:
//   1. Env config — masked status of RESEND_API_KEY / EMAIL_FROM. Tells you fast whether the
//      server has any chance of sending mail.
//   2. Send test — fires a real sendEmail() to the caller's own address and shows the wrapper
//      result. The corresponding EmailLog row appears in the history below.
//   3. History — last 100 EmailLog rows with optional ?to= filter for "all attempts to <email>".

export default async function EmailDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const ctx = await getPageContextOrRedirect();
  if (!ctx.host.isSuperAdmin) notFound();
  const sp = await searchParams;
  const filterTo = sp.to?.trim().toLowerCase() || null;

  const env = serverEnv();
  const hasKey = Boolean(env.RESEND_API_KEY);
  const hasFrom = Boolean(env.EMAIL_FROM);
  // Mask the From header — same domain everyone has but don't leak the local part to anyone
  // logging in over the shoulder.
  const fromDisplay = env.EMAIL_FROM
    ? maskEmail(env.EMAIL_FROM)
    : "(EMAIL_FROM unset)";

  const where = filterTo ? { toEmail: filterTo } : {};
  const logs = await prisma.emailLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Per-status counts over the same filter — quick health-at-a-glance.
  const [sentCount, failedCount, skippedCount] = await Promise.all([
    prisma.emailLog.count({ where: { ...where, status: "SENT" } }),
    prisma.emailLog.count({ where: { ...where, status: "FAILED" } }),
    prisma.emailLog.count({ where: { ...where, status: "SKIPPED" } }),
  ]);

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Email diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            Verify configuration and inspect every send attempt. Use this when a recipient
            says they didn&apos;t receive an email.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Soul Suite reads these from environment variables. Update them in your hosting
              provider and redeploy if anything below is unset.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="RESEND_API_KEY" value={hasKey ? "set" : "unset"} ok={hasKey} />
            <Row label="EMAIL_FROM" value={fromDisplay} ok={hasFrom} />
            {hasKey && hasFrom && (
              <p className="text-xs text-muted-foreground pt-2">
                Both set — Resend should accept sends. If recipients still don&apos;t receive,
                check{" "}
                <a
                  href="https://resend.com/domains"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  resend.com/domains
                </a>
                {" "}to confirm the sender domain is DNS-verified (otherwise Resend silently
                blocks delivery to anyone other than the account owner).
              </p>
            )}
          </CardContent>
        </Card>

        <EmailDiagnosticsClient
          callerEmail={ctx.host.email}
          configured={hasKey && hasFrom}
        />

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>
              {filterTo ? (
                <>
                  Last 100 attempts to <strong>{filterTo}</strong>.{" "}
                  <a href="/admin/email-diagnostics" className="underline">Clear filter</a>
                </>
              ) : (
                <>Last 100 send attempts across the platform.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Pill label="Sent" count={sentCount} tone="ok" />
              <Pill label="Failed" count={failedCount} tone="bad" />
              <Pill label="Skipped" count={skippedCount} tone="warn" />
            </div>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No log entries yet.</p>
            ) : (
              <ul className="rounded-md border border-border divide-y divide-border">
                {logs.map((row) => (
                  <li key={row.id} className="p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-foreground truncate">
                          <a
                            href={`/admin/email-diagnostics?to=${encodeURIComponent(row.toEmail)}`}
                            className="hover:underline"
                          >
                            {row.toEmail}
                          </a>
                          <span className="text-muted-foreground"> · {row.subject}</span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {row.fromHeader} · {new Date(row.createdAt).toLocaleString()}
                          {row.reason ? ` · ${row.reason}` : ""}
                          {row.bookingId ? ` · booking ${row.bookingId}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground tabular-nums">{label}</span>
      <span
        className={
          ok
            ? "text-foreground font-medium"
            : "text-destructive font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Pill({ label, count, tone }: { label: string; count: number; tone: "ok" | "bad" | "warn" }) {
  const cls =
    tone === "ok"
      ? "bg-foreground text-background"
      : tone === "bad"
        ? "bg-destructive/10 text-destructive"
        : "bg-accent/15 text-accent-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${cls}`}>
      {label}: {count}
    </span>
  );
}

function StatusBadge({ status }: { status: "SENT" | "FAILED" | "SKIPPED" }) {
  const map = {
    SENT: "bg-foreground text-background",
    FAILED: "bg-destructive/10 text-destructive",
    SKIPPED: "bg-surface-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${map[status]}`}
    >
      {status.toLowerCase()}
    </span>
  );
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 2) return email;
  const local = email.slice(0, at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(0, local.length - visible.length))}${email.slice(at)}`;
}
