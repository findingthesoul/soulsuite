// Tiny shared skeleton primitives. Pulse animation only — no shimmer / gradient (kept
// quiet so it doesn't compete visually with the content that follows).
//
// Used by the per-route `loading.tsx` files to fill the AppShell content slot while the
// server-rendered page is computing. AppShell itself is in the layout above so it doesn't
// re-render across navigations within /dashboard or /settings.

export function SkeletonHeader() {
  return (
    <header className="space-y-2">
      <div className="h-7 w-40 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-surface-muted" />
    </header>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded bg-surface-muted" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}
