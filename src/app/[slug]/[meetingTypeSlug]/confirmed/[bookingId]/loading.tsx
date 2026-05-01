// Lightweight loading state for the public booking confirmation page. Mostly a placeholder
// so Next.js can prefetch the route via PrefetchLink — the hosted page itself is small and
// renders quickly once data lands.

export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-12 md:px-6 md:py-20">
        <div className="rounded-xl border border-border bg-surface shadow-xs p-8 md:p-10 space-y-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 animate-pulse items-center justify-center rounded-full bg-surface-muted" />
            <div className="h-6 w-40 animate-pulse rounded-md bg-surface-muted" />
          </div>
          <div className="rounded-lg border border-border p-5 space-y-3">
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}
