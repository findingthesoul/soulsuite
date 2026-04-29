"use client";

import * as React from "react";

// Three modes: explicit light, explicit dark, or follow OS. We persist the user's choice in
// localStorage and toggle the `.dark` class on <html> based on the resolved value.
//
// To avoid a flash of the wrong theme on first paint, the layout's <head> contains a tiny
// inline script that reads localStorage and sets the class before React hydrates.

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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  // Initialise from localStorage on mount.
  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";
    setModeState(stored);
    applyMode(stored);
    setResolved(stored === "system" ? getSystem() : stored);
    document.documentElement.classList.remove("theme-loading");
  }, []);

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
