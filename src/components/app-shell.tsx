import * as React from "react";
import { UserMenu } from "@/components/user-menu";
import { Sidebar } from "@/components/sidebar";

export interface AppShellProps {
  user: { name: string; email: string };
  workspaceName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  hasWorkspace?: boolean;
  children: React.ReactNode;
}

export function AppShell({ user, workspaceName, logoUrl, brandColor, hasWorkspace = false, children }: AppShellProps) {
  // Brand color is exposed as `--brand` for components that opt in (e.g. logo bg). It does NOT
  // override --primary anymore — that broke buttons whenever someone picked a light brand color
  // (white-on-white invisible button).
  const inlineStyle = brandColor
    ? ({ "--brand": brandColor } as React.CSSProperties)
    : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground" style={inlineStyle}>
      <Sidebar workspaceName={workspaceName} logoUrl={logoUrl} brandColor={brandColor} hasWorkspace={hasWorkspace} />

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-end border-b border-border bg-surface px-4 sm:px-6">
          <UserMenu name={user.name} email={user.email} />
        </header>

        <main className="flex-1 px-4 py-8 sm:px-8 sm:py-10 w-full max-w-4xl">
          {children}
        </main>
      </div>
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
