import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { serverEnv, publicEnv } from "@/lib/env";

// Build a Google OAuth2 client for a specific host using their stored refresh token.
// Access tokens are short-lived; googleapis refreshes them automatically when needed.
export function makeOAuth2ClientForHost(refreshToken: string) {
  const env = serverEnv();
  const client = new google.auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback`,
  });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function calendarFor(refreshToken: string): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: makeOAuth2ClientForHost(refreshToken) });
}

// Filters out calendars that aren't actually the host's own. In a Google Workspace, admins
// can see colleagues' calendars as their own (`accessRole: "owner"`), and those calendars'
// IDs are the colleague's email address. We exclude any calendar whose ID looks like an
// email belonging to someone else — keeping the host's primary, sub-calendars they created
// (`...@group.calendar.google.com`), and special calendars (holidays, contacts birthdays).
export function isHostOwnedCalendar(calendarId: string, hostEmail: string): boolean {
  const id = calendarId.toLowerCase();
  const me = hostEmail.toLowerCase();
  if (id === me) return true; // primary
  if (id.endsWith("@group.calendar.google.com")) return true;
  if (id.endsWith("@group.v.calendar.google.com")) return true;
  if (id.endsWith("@import.calendar.google.com")) return true;
  // Anything else that contains "@" is treated as a foreign user's email and excluded.
  if (id.includes("@")) return false;
  return true;
}

// 401 from Google with an expired/revoked refresh token. Surface so callers can mark the host
// as needing re-auth (brief §Token rotation).
export function isGoogleAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
  return code === 401 || code === 403;
}
