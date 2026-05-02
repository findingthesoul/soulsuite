"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen, CalendarDays, Inbox, Clock, Users, HelpCircle } from "lucide-react";
import { version as APP_VERSION } from "../../package.json";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  tour?: string;
}[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true, tour: "sidebar-home" },
  { href: "/dashboard/bookings", label: "Bookings", icon: Inbox, exact: false, tour: "sidebar-bookings" },
  // Order matches the help page's three-layer model: Personal → Teams → (Workspace below).
  // The "sidebar-scheduling" tour key is kept (unchanged) for compatibility with the tour
  // selectors so existing onboarding steps still highlight this row.
  { href: "/dashboard/meeting-types", label: "Personal", icon: CalendarDays, exact: false, tour: "sidebar-scheduling" },
  { href: "/dashboard/projects", label: "Teams", icon: FolderOpen, exact: false, tour: "sidebar-teams" },
];

const SETTINGS_NAV_ITEMS = [
  { href: "/settings/availability", label: "Availability", icon: Clock, exact: false },
  { href: "/settings/members", label: "Internal", icon: Users, exact: false },
];

interface Props {
  compact?: boolean; // collapsed (icons-only) sidebar
  overlay?: boolean; // hover mode — labels appear on group-hover
  hasWorkspace?: boolean;
}

export function SidebarNav({ compact = false, overlay = false, hasWorkspace = false }: Props) {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  function navItemClass(href: string, exact: boolean) {
    const active = isActive(href, exact);
    const justify = compact && !overlay ? "justify-center" : "";
    return [
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      justify,
      active
        ? "bg-surface-muted text-foreground"
        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
    ].join(" ");
  }

  function labelClass() {
    if (!compact) return "";
    if (overlay) return "opacity-0 group-hover/sidebar:opacity-100 transition-opacity whitespace-nowrap";
    return "hidden";
  }

  function sectionLabelClass() {
    if (!compact) return "";
    if (overlay) return "opacity-0 group-hover/sidebar:opacity-100 transition-opacity";
    return "hidden";
  }

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact, tour }) => (
          <Link key={href} href={href} className={navItemClass(href, exact)} title={label} data-tour={tour}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className={labelClass()}>{label}</span>
          </Link>
        ))}

        {hasWorkspace && (
          <>
            <div className="pt-4 pb-1">
              <p className={`px-3 text-xs font-medium text-subtle-foreground uppercase tracking-wide ${sectionLabelClass()}`}>
                Workspace
              </p>
            </div>

            {SETTINGS_NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
              <Link key={href} href={href} className={navItemClass(href, exact)} title={label}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className={labelClass()}>{label}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-border px-4 py-4 space-y-2">
        <Link
          href="/support"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Help"
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          <span className={labelClass()}>Help</span>
        </Link>
        <p className={`text-xs text-subtle-foreground pl-0.5 ${labelClass()}`}>v{APP_VERSION}</p>
      </div>
    </div>
  );
}
