import { redirect } from "next/navigation";
import type { Host } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface PageContext {
  host: Host;
  workspace: {
    id: string;
    name: string;
    logoUrl: string | null;
    brandColor: string | null;
  } | null;
}

// Server helper used by every authenticated page. Loads the host and (if any) workspace
// membership in one round-trip so AppShell gets the branding it needs without each page
// re-deriving it.
export async function getPageContextOrRedirect(): Promise<PageContext> {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");

  const membership = await prisma.workspaceMember.findFirst({
    where: { hostId: host.id },
    include: {
      workspace: {
        select: { id: true, name: true, logoUrl: true, brandColor: true },
      },
    },
  });

  return {
    host,
    workspace: membership?.workspace ?? null,
  };
}

// Convenience for AppShell props.
export function shellProps(ctx: PageContext) {
  return {
    user: { name: ctx.host.name, email: ctx.host.email },
    workspaceName: ctx.workspace?.name,
    logoUrl: ctx.workspace?.logoUrl ?? null,
    brandColor: ctx.workspace?.brandColor ?? null,
  };
}
