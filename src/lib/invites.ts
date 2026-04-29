import { randomBytes } from "node:crypto";
import { publicEnv } from "@/lib/env";

// Invite tokens are opaque URL-safe strings. We don't HMAC them — the Invite row's `token`
// column is `@unique`, so possessing the token is sufficient to identify the invite.
// Email match in resolvePostSignIn (workspace.ts) is what prevents random users from claiming
// someone else's invite.
export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

// Number of days an invite link stays valid for.
export const INVITE_TTL_DAYS = 7;

export function inviteUrl(token: string): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/invite/${token}`;
}

export function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
}
