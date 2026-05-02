"use client";

import * as React from "react";
import Link from "next/link";
import { Settings, Sun, Moon, Monitor, LogOut, PanelLeftOpen, PanelLeftClose, MousePointerClick, User as UserIcon, Compass } from "lucide-react";
import { openTour } from "@/components/tour/tour";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/ui/avatar";
import { useTheme } from "@/components/theme-provider";
import { useSidebar } from "@/components/sidebar-provider";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const { mode, setMode } = useTheme();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebar();
  const signoutFormRef = React.useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        data-tour="user-menu"
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar name={name} size="md" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="px-3 pb-2">
          <p className="text-sm font-medium text-foreground truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserIcon className="h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openTour()}>
          <Compass className="h-4 w-4" />
          Take a tour
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sidebar</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sidebarMode}
          onValueChange={(v) => setSidebarMode(v as "expanded" | "collapsed" | "hover")}
        >
          <DropdownMenuRadioItem value="expanded">
            <PanelLeftOpen className="h-4 w-4" />
            Expanded
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="collapsed">
            <PanelLeftClose className="h-4 w-4" />
            Collapsed
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="hover">
            <MousePointerClick className="h-4 w-4" />
            Expand on hover
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as "light" | "dark" | "system")}>
          <DropdownMenuRadioItem value="light">
            <Sun className="h-4 w-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="h-4 w-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="h-4 w-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            signoutFormRef.current?.submit();
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
        <form ref={signoutFormRef} action="/auth/signout" method="post" className="hidden" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
