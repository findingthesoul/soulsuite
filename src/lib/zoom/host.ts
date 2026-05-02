import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/zoom/client";

// Refresh a host's Zoom access token and persist the rotated refresh token. Zoom rotates
// refresh tokens on every use, so the new one MUST be stored or the next call will 401.
//
// In-process access-token cache (P10 from the perf audit): rapid successive calls during a
// booking flow (create event → maybe rollback → email path) used to hit Zoom's token
// endpoint and write Postgres on every call. Cache the access token until ~60s before
// expiry, and serialise concurrent rotations per host so two parallel bookings don't both
// rotate and invalidate each other's tokens.

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
const _tokenCache = new Map<string, CachedToken>();
const _inflight = new Map<string, Promise<string | null>>();

async function refreshAndStore(hostId: string): Promise<string | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { zoomRefreshToken: true },
  });
  if (!host?.zoomRefreshToken) return null;

  let tokens;
  try {
    tokens = await refreshAccessToken(host.zoomRefreshToken);
  } catch (err) {
    // invalid_grant means Zoom revoked or rotated past the token we have. Auto-clear so the
    // settings page surfaces "Reconnect Zoom" and downstream features (booking finalisation,
    // MT form Zoom validation) treat the host as disconnected instead of repeatedly hitting a
    // dead token.
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|invalid token/i.test(message)) {
      await prisma.host
        .update({ where: { id: hostId }, data: { zoomRefreshToken: null } })
        .catch(() => undefined);
      _tokenCache.delete(hostId);
      return null;
    }
    throw err;
  }
  // Persist rotated refresh token (Zoom invalidates the old one). Guard with a `where`
  // condition so a concurrent rotation that already wrote a newer token wins.
  await prisma.host.update({
    where: { id: hostId, zoomRefreshToken: host.zoomRefreshToken },
    data: { zoomRefreshToken: tokens.refreshToken },
  }).catch(() => undefined);
  _tokenCache.set(hostId, {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + (tokens.expiresInSeconds - 60) * 1000,
  });
  return tokens.accessToken;
}

export async function getZoomAccessTokenForHost(hostId: string): Promise<string | null> {
  const cached = _tokenCache.get(hostId);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  // Coalesce concurrent rotations.
  const inflight = _inflight.get(hostId);
  if (inflight) return inflight;
  const p = refreshAndStore(hostId).finally(() => _inflight.delete(hostId));
  _inflight.set(hostId, p);
  return p;
}

// True iff the host has any Zoom credentials stored. Cheap — just a column read.
export async function hostHasZoom(hostId: string): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { zoomRefreshToken: true },
  });
  return !!host?.zoomRefreshToken;
}

// Called when a host disconnects Zoom — clears any in-process token cache so we don't
// keep using a token whose refresh token has been wiped.
export function clearZoomTokenCache(hostId: string): void {
  _tokenCache.delete(hostId);
}
