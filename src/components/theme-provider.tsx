"use client";

import * as React from "react";

// Three modes: explicit light, explicit dark, or follow OS. The user's choice is persisted in
// TWO places:
//   - localStorage on the browser → consulted at first paint to avoid a theme flash.
//   - Host.themePreference on the DB → consulted at hydration to override stale localStorage
//     so the preference follows the user across browsers / devices / fresh sign-ins.
//
// When the user picks a mode we write to both. The inline init script in the layout reads
// localStorage; the server-rendered value gets layered on via the initialMode prop which the
// root layout passes in based on the signed-in host.

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "soul-suite:theme";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolved: "light" | "dark";
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function getSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = mode === "system" ? getSystem() : mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// Persist the choice to the DB. Best-effort — failures don't block the local toggle (the
// localStorage write below means the visual change is immediate, and the next sign-in will
// pull whatever's stored on the Host row).
function pushToServer(mode: ThemeMode) {
  const dbValue: "LIGHT" | "DARK" | "SYSTEM" =
    mode === "light" ? "LIGHT" : mode === "dark" ? "DARK" : "SYSTEM";
  fetch("/api/settings/theme", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: dbValue }),
    keepalive: true,
  }).catch(() => undefined);
}

export function ThemeProvider({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  // Server-side hint for the signed-in host's saved preference. When set, it wins over
  // localStorage on mount (so a different browser shows the same theme as the user's last
  // configured choice). null = use whatever localStorage says, falling back to system.
  initialMode?: ThemeMode | null;
}) {
  const [mode, setModeState] = React.useState<ThemeMode>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  // Initialise on mount. If the server passed an initialMode (signed-in host with a saved
  // preference), that wins — and we sync it back into localStorage so the next first-paint
  // matches on this browser too. Otherwise read localStorage, fall back to "system".
  React.useEffect(() => {
    const fromStorage = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? null;
    const initial: ThemeMode = initialMode ?? fromStorage ?? "system";
    setModeState(initial);
    applyMode(initial);
    setResolved(initial === "system" ? getSystem() : initial);
    if (initialMode && initial !== fromStorage) {
      localStorage.setItem(STORAGE_KEY, initial);
    }
    document.documentElement.classList.remove("theme-loading");
  }, [initialMode]);

  // Re-apply when the OS preference changes (only if mode is "system").
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") {
        applyMode("system");
        setResolved(getSystem());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
    setResolved(next === "system" ? getSystem() : next);
    pushToServer(next);
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode, resolved }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

// Inline script string injected into <head> by the root layout so the correct class is set
// before first paint — avoids the dreaded white-flash on a dark-themed dashboard.
export const themeInitScript = `
(function() {
  try {
    var mode = localStorage.getItem('${STORAGE_KEY}') || 'system';
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.classList.add('theme-loading');
  } catch(e) {}
})();
`.trim();
