import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/microsoft/client";

// Refresh a host's Microsoft Graph access token and persist the rotated refresh token.
// Microsoft typically rotates refresh tokens on every use, so the new one MUST be stored
// or the next call will 401.
//
// Mirrors src/lib/zoom/host.ts: in-process access-token cache + per-host inflight Promise
// map to coalesce concurrent rotations during a booking flow.

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
const _tokenCache = new Map<string, CachedToken>();
const _inflight = new Map<string, Promise<string | null>>();

async function refreshAndStore(hostId: string): Promise<string | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { microsoftRefreshToken: true },
  });
  if (!host?.microsoftRefreshToken) return null;

  const tokens = await refreshAccessToken(host.microsoftRefreshToken);
  // Persist rotated refresh token. Guard with a `where` condition so a concurrent rotation
  // that already wrote a newer token wins.
  await prisma.host
    .update({
      where: { id: hostId, microsoftRefreshToken: host.microsoftRefreshToken },
      data: { microsoftRefreshToken: tokens.refreshToken },
    })
    .catch(() => undefined);
  _tokenCache.set(hostId, {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + (tokens.expiresInSeconds - 60) * 1000,
  });
  return tokens.accessToken;
}

export async function getMicrosoftAccessTokenForHost(hostId: string): Promise<string | null> {
  const cached = _tokenCache.get(hostId);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const inflight = _inflight.get(hostId);
  if (inflight) return inflight;
  const p = refreshAndStore(hostId).finally(() => _inflight.delete(hostId));
  _inflight.set(hostId, p);
  return p;
}

export async function hostHasMicrosoft(hostId: string): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { microsoftRefreshToken: true },
  });
  return !!host?.microsoftRefreshToken;
}

export function clearMicrosoftTokenCache(hostId: string): void {
  _tokenCache.delete(hostId);
}
