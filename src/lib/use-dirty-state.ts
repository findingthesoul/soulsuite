"use client";

import { useCallback, useState } from "react";

// Tracks form draft vs. last-committed snapshot. `dirty` is true when they differ
// (shallow JSON-compare — fine for the small flat-ish forms we have).
//
// Pattern: forms render inputs bound to `draft`. Save handler calls `commit(newSnapshot)`
// to mark the new server state as the "clean" baseline. Discard calls `discard()` to
// reset the draft back to the snapshot.
export function useDirtyState<T>(initial: T) {
  const [snapshot, setSnapshot] = useState<T>(initial);
  const [draft, setDraft] = useState<T>(initial);

  const update = useCallback((patch: Partial<T> | ((prev: T) => T)) => {
    setDraft((prev) => (typeof patch === "function" ? (patch as (p: T) => T)(prev) : { ...prev, ...patch }));
  }, []);

  const discard = useCallback(() => setDraft(snapshot), [snapshot]);
  const commit = useCallback((next: T) => {
    setSnapshot(next);
    setDraft(next);
  }, []);

  const dirty = !shallowEqual(draft, snapshot);

  return { draft, snapshot, dirty, update, discard, commit, setDraft };
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
