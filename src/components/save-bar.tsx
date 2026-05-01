"use client";

import { Button } from "@/components/ui/button";

/**
 * Page-header save bar for direct-edit forms. Sits to the right of the page heading and
 * stays in view while the user scrolls (the header itself is sticky at the AppShell level).
 *
 * - Hidden when the form is clean — keeps the page calm.
 * - Discard reverts to the persisted snapshot; Save persists then re-snapshots.
 *
 * Pair with `useDirtyState` from `@/lib/use-dirty-state`.
 */
export function SaveBar({
  dirty,
  pending,
  onSave,
  onDiscard,
  saveLabel = "Save",
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onDiscard} disabled={pending}>
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}

/**
 * Standard page heading + SaveBar layout. Heading on the left, action on the right, both
 * top-aligned so a tall description doesn't push the button down.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="shrink-0 pt-1">{actions}</div>}
    </header>
  );
}
