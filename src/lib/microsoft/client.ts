import { serverEnv, publicEnv } from "@/lib/env";

// Microsoft Graph OAuth (delegated). Tokens are stored on Host (microsoftRefreshToken).
// Access tokens are short-lived (~1h) — we exchange refresh → access on every API call.
// Microsoft rotates refresh tokens on each use, so we always persist the new one.
//
// Multi-tenant by default (MICROSOFT_TENANT_ID="common"): hosts from any Azure tenant can
// connect, and onlineMeetings can be created with attendees from any other tenant. This is
// the right choice for Soul Suite because invitees aren't always on soul.com.
//
// Scopes (delegated): OnlineMeetings.ReadWrite, User.Read, offline_access.

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export const MICROSOFT_REDIRECT_PATH = "/api/oauth/microsoft/callback";

export const MICROSOFT_SCOPES = [
  "OnlineMeetings.ReadWrite",
  "User.Read",
  "offline_access",
] as const;

function tenant(): string {
  return serverEnv().MICROSOFT_TENANT_ID;
}

function tokenEndpoint(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}

function authorizeEndpoint(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
}

export function microsoftAuthorizeUrl(state: string): string {
  const env = serverEnv();
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: `${publicEnv.NEXT_PUBLIC_APP_URL}${MICROSOFT_REDIRECT_PATH}`,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    // Force the consent screen so a host that re-connects always re-grants offline_access.
    prompt: "select_account",
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<MicrosoftTokens> {
  const env = serverEnv();
  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!json.refresh_token) {
    // Without offline_access scope (or if user revoked) we won't get a refresh token —
    // surface that explicitly so we don't persist a useless null.
    throw new Error("Microsoft token response missing refresh_token (offline_access required).");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<MicrosoftTokens> {
  const env = serverEnv();
  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Microsoft token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    // Microsoft typically rotates the refresh token on every use; fall back to the old one
    // if the response omits it (rare but documented for some flows).
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSeconds: json.expires_in,
  };
}

export async function fetchMicrosoftUser(
  accessToken: string,
): Promise<{ email: string; id: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Microsoft user fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    id: string;
    mail?: string | null;
    userPrincipalName?: string | null;
  };
  return { id: json.id, email: json.mail ?? json.userPrincipalName ?? "" };
}

export interface CreateTeamsMeetingArgs {
  subject: string;
  startsAtIso: string;
  endsAtIso: string;
  // Email addresses of additional attendees (co-hosts). For Microsoft Graph onlineMeetings
  // the `participants.attendees[].upn` accepts cross-tenant emails for a multi-tenant app —
  // the booking flow retries without attendees on rejection. See TeamsAttendeesError.
  attendees?: string[];
}

export interface CreatedTeamsMeeting {
  id: string;
  joinUrl: string;
}

// Graph rejects attendees that can't be resolved (e.g. tenant policy blocks external users).
// Surface a typed error so the booking flow can retry without attendees, mirroring the
// ZoomAlternativeHostsError pattern.
export class TeamsAttendeesError extends Error {
  constructor(public readonly underlying: string) {
    super(`Microsoft rejected attendees: ${underlying}`);
    this.name = "TeamsAttendeesError";
  }
}

export async function createTeamsMeeting(
  accessToken: string,
  args: CreateTeamsMeetingArgs,
): Promise<CreatedTeamsMeeting> {
  const includeAttendees = args.attendees && args.attendees.length > 0;
  const payload: Record<string, unknown> = {
    subject: args.subject,
    startDateTime: args.startsAtIso,
    endDateTime: args.endsAtIso,
  };
  if (includeAttendees) {
    payload.participants = {
      attendees: args.attendees!.map((email) => ({
        upn: email,
        role: "presenter",
      })),
    };
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    // Graph returns 400/403 with messages mentioning "attendee", "participant", or
    // "could not be resolved" when an attendee email isn't acceptable. Retry without
    // attendees in the booking flow.
    if (
      includeAttendees &&
      (res.status === 400 || res.status === 403) &&
      /attendee|participant|resolve|upn|tenant/i.test(text)
    ) {
      throw new TeamsAttendeesError(text);
    }
    throw new Error(`Microsoft Teams meeting creation failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id: string; joinWebUrl?: string; joinUrl?: string };
  // Graph v1.0 returns `joinWebUrl`; some endpoints/older docs use `joinUrl`. Prefer the
  // documented field but fall back so we don't silently store null.
  const joinUrl = json.joinWebUrl ?? json.joinUrl ?? "";
  if (!joinUrl) {
    throw new Error("Microsoft Teams meeting creation succeeded but no join URL was returned.");
  }
  return { id: json.id, joinUrl };
}

export async function deleteTeamsMeeting(
  accessToken: string,
  meetingId: string,
): Promise<void> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  // 204 (deleted) or 404 (already gone) are both fine.
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Microsoft Teams meeting delete failed: ${res.status} ${await res.text()}`);
  }
}

export interface UpdateTeamsMeetingArgs {
  startsAtIso: string;
  endsAtIso: string;
}

export async function updateTeamsMeeting(
  accessToken: string,
  meetingId: string,
  args: UpdateTeamsMeetingArgs,
): Promise<void> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDateTime: args.startsAtIso,
        endDateTime: args.endsAtIso,
      }),
    },
  );
  if (!res.ok && res.status !== 200 && res.status !== 204) {
    throw new Error(`Microsoft Teams meeting update failed: ${res.status} ${await res.text()}`);
  }
}

export function isMicrosoftConfigured(): boolean {
  const env = serverEnv();
  return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}
