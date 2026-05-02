"use client";

import { useCallback, useState } from "react";

/**
 * Direct-edit form state. Tracks the persisted snapshot and the working draft separately
 * so the UI can:
 *   - render `draft` into always-editable inputs
 *   - flip a top-right Save button to primary as soon as `dirty === true`
 *   - revert to the persisted snapshot via `reset()`
 *   - update the snapshot after a successful save via `commit(next)`
 *
 * Dirty detection is a shallow JSON compare — fine for the simple object shapes our settings
 * forms use. If you ever need it for trees with non-serialisable values (Dates, functions),
 * pass a custom comparator.
 */
export function useDirtyState<T>(initial: T, isEqual: (a: T, b: T) => boolean = jsonEqual) {
  const [committed, setCommitted] = useState<T>(initial);
  const [draft, setDraft] = useState<T>(initial);

  const reset = useCallback(() => setDraft(committed), [committed]);
  const commit = useCallback((next: T) => {
    setCommitted(next);
    setDraft(next);
  }, []);
  // `update` accepts either a partial patch (for object drafts) or an updater fn — convenient
  // alternative to `setDraft({ ...prev, foo: 1 })` at call sites. `discard` is an alias for
  // `reset` to match the earlier pilot API; both names are stable.
  const update = useCallback((patch: Partial<T> | ((prev: T) => T)) => {
    setDraft((prev) =>
      typeof patch === "function"
        ? (patch as (p: T) => T)(prev)
        : ({ ...(prev as object), ...(patch as object) } as T),
    );
  }, []);

  const dirty = !isEqual(committed, draft);

  return {
    draft,
    setDraft,
    committed,
    snapshot: committed,
    dirty,
    reset,
    discard: reset,
    update,
    commit,
  } as const;
}

function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
