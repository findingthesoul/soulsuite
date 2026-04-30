"use client";

import * as React from "react";

// Sidebar visibility mode. Mirrors the theme-provider pattern (localStorage + init script).
// - expanded: full-width sidebar with labels (default)
// - collapsed: icon-only narrow rail
// - hover: collapsed rail that expands on mouse-over (overlay, doesn't shift content)
export type SidebarMode = "expanded" | "collapsed" | "hover";

const STORAGE_KEY = "soul-suite:sidebar-mode";

interface SidebarContextValue {
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<SidebarMode>("expanded");

  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as SidebarMode | null) ?? "expanded";
    setModeState(stored);
    document.documentElement.dataset.sidebar = stored;
  }, []);

  const setMode = React.useCallback((next: SidebarMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.sidebar = next;
  }, []);

  return <SidebarContext.Provider value={{ mode, setMode }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used inside SidebarProvider");
  return ctx;
}

// Inline script — sets data-sidebar before first paint to avoid flash from default → stored.
export const sidebarInitScript = `
(function() {
  try {
    var m = localStorage.getItem('${STORAGE_KEY}') || 'expanded';
    document.documentElement.dataset.sidebar = m;
  } catch(e) {}
})();
`.trim();
