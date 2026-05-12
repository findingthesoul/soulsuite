import * as React from "react";
import { UserMenu } from "@/components/user-menu";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";

export interface AppShellProps {
  user: { name: string; email: string };
  workspaceName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  hasWorkspace?: boolean;
  canManageWorkspace?: boolean;
  isSuperAdmin?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  user,
  workspaceName,
  logoUrl,
  brandColor,
  hasWorkspace = false,
  canManageWorkspace = false,
  isSuperAdmin = false,
  children,
}: AppShellProps) {
  // Brand color is exposed as `--brand` for components that opt in (e.g. logo bg). It does NOT
  // override --primary anymore — that broke buttons whenever someone picked a light brand color
  // (white-on-white invisible button).
  const inlineStyle = brandColor
    ? ({ "--brand": brandColor } as React.CSSProperties)
    : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground" style={inlineStyle}>
      <Sidebar
        workspaceName={workspaceName}
        logoUrl={logoUrl}
        brandColor={brandColor}
        hasWorkspace={hasWorkspace}
        canManageWorkspace={canManageWorkspace}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
        {/* Top bar — primary nav lives in the BottomNav on mobile, so the header
            is right-aligned (UserMenu only) at every breakpoint. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border bg-surface px-4 sm:px-6">
          <UserMenu name={user.name} email={user.email} />
        </header>

        {/* pb-24 below md leaves room for the fixed bottom nav (~64px) plus a
            comfortable gap; safe-area-inset is added on top via the nav itself.
            Desktop drops the extra padding since the sidebar handles nav. */}
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-10 w-full max-w-4xl pb-24 md:pb-10">
          {children}
        </main>
      </div>

      <BottomNav hasWorkspace={hasWorkspace} canManageWorkspace={canManageWorkspace} />
    </div>
  );
}

// For unauthenticated pages (sign-in, error, request-access). Centred, no sidebar.
export function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      {children}
    </div>
  );
}
