import { serverEnv, publicEnv } from "@/lib/env";

// Zoom User-managed OAuth. Tokens are stored on Host (zoomRefreshToken). Access tokens are
// short-lived (1h) — we exchange refresh → access on every API call. Zoom rotates refresh
// tokens on each use, so we always persist the new one returned alongside the access token.
//
// Scopes assumed (granular): meeting:write:meeting, user:read:user.

export interface ZoomTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export const ZOOM_REDIRECT_PATH = "/api/oauth/zoom/callback";

export function zoomAuthorizeUrl(state: string): string {
  const env = serverEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ZOOM_CLIENT_ID ?? "",
    redirect_uri: `${publicEnv.NEXT_PUBLIC_APP_URL}${ZOOM_REDIRECT_PATH}`,
    state,
  });
  return `https://zoom.us/oauth/authorize?${params.toString()}`;
}

function basicAuthHeader(): string {
  const env = serverEnv();
  const creds = `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

export async function exchangeCodeForTokens(code: string): Promise<ZoomTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${publicEnv.NEXT_PUBLIC_APP_URL}${ZOOM_REDIRECT_PATH}`,
  });
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Zoom token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in };
}

export async function refreshAccessToken(refreshToken: string): Promise<ZoomTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Zoom token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in };
}

export async function fetchZoomUser(accessToken: string): Promise<{ email: string; id: string }> {
  const res = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Zoom user fetch failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string; email: string };
  return { id: json.id, email: json.email };
}

export interface CreateZoomMeetingArgs {
  topic: string;
  startsAtIso: string;
  durationMinutes: number;
  timezone: string;
  agenda?: string;
}

export interface CreatedZoomMeeting {
  meetingId: string;
  joinUrl: string;
  passcode: string | null;
}

// Creates a scheduled (type=2) meeting on the host's Zoom account. We deliberately don't
// pass an alternative_hosts list — v1 ties bookings 1:1 to a single host.
export async function createZoomMeeting(accessToken: string, args: CreateZoomMeetingArgs): Promise<CreatedZoomMeeting> {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: args.topic,
      type: 2,
      start_time: args.startsAtIso,
      duration: args.durationMinutes,
      timezone: args.timezone,
      agenda: args.agenda,
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  if (!res.ok) throw new Error(`Zoom meeting creation failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: number; join_url: string; password?: string };
  return { meetingId: String(json.id), joinUrl: json.join_url, passcode: json.password ?? null };
}

export interface UpdateZoomMeetingArgs {
  startsAtIso: string;
  durationMinutes: number;
  timezone: string;
}

export async function updateZoomMeeting(accessToken: string, meetingId: string, args: UpdateZoomMeetingArgs): Promise<void> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      start_time: args.startsAtIso,
      duration: args.durationMinutes,
      timezone: args.timezone,
    }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Zoom meeting update failed: ${res.status} ${await res.text()}`);
  }
}

export async function deleteZoomMeeting(accessToken: string, meetingId: string): Promise<void> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Zoom meeting delete failed: ${res.status} ${await res.text()}`);
  }
}

export function isZoomConfigured(): boolean {
  const env = serverEnv();
  return !!(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);
}
