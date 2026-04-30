import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/zoom/client";

// Refresh a host's Zoom access token and persist the rotated refresh token. Zoom rotates
// refresh tokens on every use, so the new one MUST be stored or the next call will 401.
//
// Returns null when the host hasn't connected Zoom yet — callers should fall back or error
// based on context (e.g. booking should error; UI should hide the option).
export async function getZoomAccessTokenForHost(hostId: string): Promise<string | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { zoomRefreshToken: true },
  });
  if (!host?.zoomRefreshToken) return null;

  const tokens = await refreshAccessToken(host.zoomRefreshToken);
  await prisma.host.update({
    where: { id: hostId },
    data: { zoomRefreshToken: tokens.refreshToken },
  });
  return tokens.accessToken;
}

// True iff the host has any Zoom credentials stored. Cheap — just a column read.
export async function hostHasZoom(hostId: string): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { zoomRefreshToken: true },
  });
  return !!host?.zoomRefreshToken;
}
