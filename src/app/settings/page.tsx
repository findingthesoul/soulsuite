import Link from "next/link";
import { ChevronRight, Palette, Users, Building2, CalendarRange, Clock, Video, User as UserIcon } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";

export default async function SettingsIndexPage() {
  const ctx = await getPageContextOrRedirect();
  const membership = await getWorkspaceRole(ctx.host);

  const sections: {
    href: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    gated?: boolean;
    section: "personal" | "workspace";
  }[] = [
    {
      href: "/settings/profile",
      title: "Profile",
      description: "Name, phone, location, bio, photo.",
      icon: UserIcon,
      section: "personal",
    },
    {
      href: "/settings/availability",
      title: "Availability",
      description: "Timezone and weekly working hours.",
      icon: Clock,
      section: "personal",
    },
    {
      href: "/settings/calendars",
      title: "Calendars",
      description: "Conflict-source calendars and the write target for new bookings.",
      icon: CalendarRange,
      section: "personal",
    },
    {
      href: "/settings/connections",
      title: "Connections",
      description: "Connect Zoom (and later Teams) so meeting types can use them.",
      icon: Video,
      section: "personal",
    },
    {
      href: "/settings/branding",
      title: "Branding",
      description: "Workspace logo and brand colour.",
      icon: Palette,
      gated: !canManageWorkspace(membership?.role),
      section: "workspace",
    },
    {
      href: "/settings/members",
      title: "Members",
      description: "Workspace members and pending invites.",
      icon: Users,
      gated: !canManageWorkspace(membership?.role),
      section: "workspace",
    },
    {
      href: "/settings/workspace",
      title: "Workspace",
      description: "Name, slug, primary email domain.",
      icon: Building2,
      gated: !canManageWorkspace(membership?.role),
      section: "workspace",
    },
  ];

  const personal = sections.filter((s) => s.section === "personal");
  const workspace = sections.filter((s) => s.section === "workspace");

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Personal and workspace configuration.</p>
        </header>

        <SettingsGroup title="Personal" sections={personal} />
        <SettingsGroup title="Workspace" sections={workspace} />
      </div>
    </AppShell>
  );
}

function SettingsGroup({
  title,
  sections,
}: {
  title: string;
  sections: {
    href: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    gated?: boolean;
  }[];
}) {
  if (sections.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">{title}</h2>
      <Card>
        <ul className="divide-y divide-border">
          {sections.map((section) => {
            const Icon = section.icon;
            if (section.gated) {
              return (
                <li key={section.href} className="flex items-center gap-3 p-4 opacity-50">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{section.title}</p>
                    <p className="text-xs text-muted-foreground">Admin only</p>
                  </div>
                </li>
              );
            }
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="flex items-center gap-3 p-4 hover:bg-surface-muted transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{section.title}</p>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-subtle-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
