"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";

interface Props {
  workspaceName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  hasWorkspace?: boolean;
}

// Mobile-only entry point into the primary nav. The desktop sidebar is
// `hidden md:flex` (see Sidebar), so on phones we surface a hamburger in the
// AppShell header that opens a left-edge drawer with the same nav items.
//
// Keeping it a separate component avoids touching the desktop sidebar layout
// at all — the only responsive change is "show this button below md".
export function MobileNav({ workspaceName, logoUrl, brandColor, hasWorkspace = false }: Props) {
  const [open, setOpen] = React.useState(false);

  // Close on route change (Next.js doesn't re-mount the shell, so we listen
  // to the browser's history events as a proxy).
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [open]);

  // Lock body scroll while the drawer is open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="relative h-full w-64 max-w-[80vw] flex flex-col border-r border-border bg-surface">
            <div className="flex h-14 shrink-0 items-center justify-between gap-2.5 border-b border-border px-4">
              <Link
                href="/dashboard"
                className="flex items-center gap-2.5 text-sm font-semibold text-foreground"
                onClick={() => setOpen(false)}
              >
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt={`${workspaceName ?? "Soul Suite"} logo`}
                    width={24}
                    height={24}
                    unoptimized
                    className="h-6 w-6 object-contain rounded-md shrink-0"
                  />
                ) : (
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
                    style={brandColor ? { backgroundColor: brandColor, color: "#0c0a09" } : undefined}
                  >
                    S
                  </span>
                )}
                <span className="truncate">{workspaceName ?? "Soul Suite"}</span>
              </Link>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto" onClick={() => setOpen(false)}>
              <SidebarNav hasWorkspace={hasWorkspace} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
