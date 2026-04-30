"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen, CalendarDays, Inbox, Clock, Users, Vote, HelpCircle } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/bookings", label: "Bookings", icon: Inbox, exact: false },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen, exact: false },
  { href: "/dashboard/meeting-types", label: "Scheduling", icon: CalendarDays, exact: false },
  { href: "/dashboard/polls", label: "Polls", icon: Vote, exact: false },
];

const SETTINGS_NAV_ITEMS = [
  { href: "/settings/availability", label: "Availability", icon: Clock, exact: false },
  { href: "/settings/members", label: "Members", icon: Users, exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  function navItemClass(href: string, exact: boolean) {
    const active = isActive(href, exact);
    return [
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-surface-muted text-foreground"
        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
    ].join(" ");
  }

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
          <Link key={href} href={href} className={navItemClass(href, exact)}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}

        <div className="pt-4 pb-1">
          <p className="px-3 text-xs font-medium text-subtle-foreground uppercase tracking-wide">Workspace</p>
        </div>

        {SETTINGS_NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
          <Link key={href} href={href} className={navItemClass(href, exact)}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-4 space-y-2">
        <a
          href="mailto:support@soul.com"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          Support
        </a>
        <p className="text-xs text-subtle-foreground pl-0.5">v0.1.0</p>
      </div>
    </div>
  );
}
