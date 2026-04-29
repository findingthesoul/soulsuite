import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { UserMenu } from "@/components/user-menu";

interface AppShellProps {
  user: { name: string; email: string };
  workspaceName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  children: React.ReactNode;
}

// Wraps every authenticated page with a consistent header (logo/workspace + user menu).
// `brandColor`, when set, overrides the --primary token for the page so the accent matches.
export function AppShell({ user, workspaceName, logoUrl, brandColor, children }: AppShellProps) {
  const inlineStyle = brandColor
    ? ({ "--primary": brandColor, "--ring": brandColor } as React.CSSProperties)
    : undefined;

  return (
    <div className="min-h-screen bg-background text-foreground" style={inlineStyle}>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={`${workspaceName ?? "Soul Suite"} logo`}
                width={28}
                height={28}
                unoptimized
                className="h-7 w-7 object-contain rounded-md"
              />
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                S
              </span>
            )}
            <span>{workspaceName ?? "Soul Suite"}</span>
          </Link>
          <UserMenu name={user.name} email={user.email} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

// For unauthenticated pages (sign-in, error, request-access). Centred, no header.
export function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      {children}
    </div>
  );
}
