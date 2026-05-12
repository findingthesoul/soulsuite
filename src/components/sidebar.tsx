"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { SidebarNav } from "@/components/sidebar-nav";
import { useSidebar } from "@/components/sidebar-provider";

interface Props {
  workspaceName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  hasWorkspace?: boolean;
  canManageWorkspace?: boolean;
  isSuperAdmin?: boolean;
}

export function Sidebar({
  workspaceName,
  logoUrl,
  brandColor,
  hasWorkspace = false,
  canManageWorkspace = false,
  isSuperAdmin = false,
}: Props) {
  const { mode } = useSidebar();
  const isCollapsed = mode === "collapsed" || mode === "hover";
  const isOverlay = mode === "hover";

  // Hover-mode UX: sidebar is fixed, sits at collapsed width, expands on mouse-over (overlay).
  // Otherwise it's part of the flex layout and pushes content based on its width.
  const baseClasses = [
    "hidden md:flex flex-col border-r border-border bg-surface overflow-y-auto",
    "transition-[width] duration-150",
    isOverlay ? "fixed inset-y-0 left-0 z-30 group/sidebar" : "shrink-0",
    isCollapsed ? "w-14" : "w-52",
    isOverlay ? "hover:w-52" : "",
  ].join(" ");

  return (
    <>
      <aside className={baseClasses} aria-label="Primary">
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 text-sm font-semibold text-foreground"
            title={workspaceName ?? "Soul Suite"}
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
            <span
              className={
                isCollapsed
                  ? isOverlay
                    ? "truncate opacity-0 group-hover/sidebar:opacity-100 transition-opacity"
                    : "hidden"
                  : "truncate"
              }
            >
              {workspaceName ?? "Soul Suite"}
            </span>
          </Link>
        </div>

        <SidebarNav
          compact={isCollapsed}
          overlay={isOverlay}
          hasWorkspace={hasWorkspace}
          canManageWorkspace={canManageWorkspace}
          isSuperAdmin={isSuperAdmin}
        />
      </aside>

      {/* Spacer in hover mode so the fixed sidebar doesn't overlap content. */}
      {isOverlay && <div className="hidden md:block w-14 shrink-0" aria-hidden />}
    </>
  );
}
