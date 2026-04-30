import { prisma } from "@/lib/prisma";

// V1 has a single workspace, so this resolver doesn't take a scope yet. When multi-workspace
// lands, callers will pass a workspaceId (or hostId/projectId we can derive it from).
//
// Returns null when no workspace exists or no logo is set — templates handle null and just
// skip the logo block.
let _cached: { logoUrl: string | null; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export async function getEmailLogoUrl(): Promise<string | null> {
  const now = Date.now();
  if (_cached && _cached.expiresAt > now) return _cached.logoUrl;

  const ws = await prisma.workspace.findFirst({ select: { logoUrl: true } });
  const logoUrl = ws?.logoUrl ?? null;
  _cached = { logoUrl, expiresAt: now + TTL_MS };
  return logoUrl;
}
