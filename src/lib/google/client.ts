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
//
// Cross-account shares with explicit write access (e.g. a personal Gmail calendar shared to
// the host with "Make changes to events") are also kept — they show up with the source
// account's email as the ID and `accessRole: "writer"`. The Workspace-admin "appears as owner"
// case is intentionally excluded by ONLY admitting `writer` from foreign-looking IDs, not
// `owner`.
export function isAccessibleCalendar(
  calendarId: string,
  hostEmail: string,
  accessRole: string | null | undefined,
): boolean {
  const id = calendarId.toLowerCase();
  const me = hostEmail.toLowerCase();
  if (id === me) return true; // primary
  if (id.endsWith("@group.calendar.google.com")) return true;
  if (id.endsWith("@group.v.calendar.google.com")) return true;
  if (id.endsWith("@import.calendar.google.com")) return true;
  // Anything else with an "@" looks like a foreign user. Admit it only when the host has
  // explicit `writer` access — that means it was deliberately shared (vs. surfaced via
  // domain-admin delegation, which arrives as `owner`).
  if (id.includes("@")) return accessRole === "writer";
  return true;
}

// Legacy alias for callers that haven't migrated to the accessRole-aware signature yet.
export function isHostOwnedCalendar(calendarId: string, hostEmail: string): boolean {
  return isAccessibleCalendar(calendarId, hostEmail, null);
}

// 401 from Google with an expired/revoked refresh token. Surface so callers can mark the host
// as needing re-auth (brief §Token rotation).
export function isGoogleAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
  return code === 401 || code === 403;
}
