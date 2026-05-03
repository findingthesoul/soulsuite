"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  CalendarDays,
  FolderOpen,
  Menu,
  Clock,
  Users,
  BookUser,
  CreditCard,
  HelpCircle,
} from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

// WhatsApp-style bottom tab bar — five primary slots, last one ("More") opens a
// sheet with the secondary nav. Visible on mobile only; desktop keeps the sidebar.
//
// AppShell pads the main content with `pb-20` below md so the last bit of page
// content isn't hidden behind the bar. Safe-area inset is added on top of that
// padding via the sheet/nav `padding-bottom: env(safe-area-inset-bottom)`.

interface Props {
  hasWorkspace?: boolean;
}

const PRIMARY = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/bookings", label: "Bookings", icon: Inbox, exact: false },
  { href: "/dashboard/meeting-types", label: "Personal", icon: CalendarDays, exact: false },
  { href: "/dashboard/projects", label: "Teams", icon: FolderOpen, exact: false },
] as const;

const MORE_PERSONAL = [
  { href: "/settings/availability", label: "Availability", icon: Clock },
  { href: "/dashboard/payments", label: "Payments", icon: CreditCard },
] as const;

const MORE_WORKSPACE = [
  { href: "/settings/members", label: "Internal team", icon: Users },
  { href: "/dashboard/contacts", label: "Contacts", icon: BookUser },
] as const;

const MORE_FOOTER = [
  { href: "/support", label: "Help", icon: HelpCircle },
] as const;

export function BottomNav({ hasWorkspace = false }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  // Active when any of the More-sheet items match the current path. Surfaces a
  // visual hint on the More button so the user knows where they are even though
  // the route doesn't map to a primary tab.
  const inMore =
    !PRIMARY.some((p) => isActive(p.href, p.exact)) &&
    [...MORE_PERSONAL, ...MORE_WORKSPACE, ...MORE_FOOTER].some((m) =>
      pathname === m.href || pathname.startsWith(m.href + "/"),
    );

  return (
    <>
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {PRIMARY.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={tabClass(active)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium leading-none">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={tabClass(inMore)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-label="More navigation"
            >
              <Menu className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} ariaLabel="More navigation">
        <div className="px-2 pb-3">
          <SheetSection title="You" items={MORE_PERSONAL} onNavigate={() => setMoreOpen(false)} pathname={pathname} />
          {hasWorkspace && (
            <SheetSection
              title="Workspace"
              items={MORE_WORKSPACE}
              onNavigate={() => setMoreOpen(false)}
              pathname={pathname}
            />
          )}
          <SheetSection title="" items={MORE_FOOTER} onNavigate={() => setMoreOpen(false)} pathname={pathname} />
        </div>
      </BottomSheet>
    </>
  );
}

function tabClass(active: boolean) {
  return [
    "flex h-16 w-full flex-col items-center justify-center gap-1 transition-colors",
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

function SheetSection({
  title,
  items,
  onNavigate,
  pathname,
}: {
  title: string;
  items: ReadonlyArray<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
  onNavigate: () => void;
  pathname: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="pt-2">
      {title && (
        <p className="px-3 pt-2 pb-1 text-xs font-medium text-subtle-foreground uppercase tracking-wide">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                className={[
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-surface-muted text-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
