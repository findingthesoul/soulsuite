"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

// Persists a set of URL search params to localStorage so the user lands on their last view
// when navigating to the same path without explicit params.
//
// Behaviour on mount:
//   - For each tracked key, if the URL has it: write the value to localStorage.
//   - If the URL is missing every tracked key AND localStorage has stored values: replace
//     the URL with the stored params (router.replace, no history entry).
// On every URL change after that, write the current values to localStorage.
//
// Trade-off: there's a brief tick where the page shows the default view before the
// replace fires. Acceptable — the loading skeleton covers it. Bookmarks / shareable URLs
// always win because explicit params override stored ones.

export function PersistSearchParams({ keys, storageKey }: { keys: string[]; storageKey: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const didInit = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const present = keys.filter((k) => searchParams.has(k));

    if (!didInit.current && present.length === 0) {
      // No URL params — try to restore from localStorage.
      didInit.current = true;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const stored = JSON.parse(raw) as Record<string, string>;
        const params = new URLSearchParams();
        for (const k of keys) {
          const v = stored[k];
          if (typeof v === "string" && v.length > 0) params.set(k, v);
        }
        const qs = params.toString();
        if (qs) router.replace(`${pathname}?${qs}`);
      } catch {
        // Corrupt JSON — ignore.
      }
      return;
    }

    didInit.current = true;
    // URL has params — persist current values.
    const snapshot: Record<string, string> = {};
    for (const k of keys) {
      const v = searchParams.get(k);
      if (v !== null) snapshot[k] = v;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // Quota or disabled — ignore.
    }
  }, [pathname, searchParams, keys, storageKey, router]);

  return null;
}
