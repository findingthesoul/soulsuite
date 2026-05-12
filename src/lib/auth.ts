import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGoogleRefreshTokenForAuthUser } from "@/lib/supabase/service";
import { generateUniqueSlug } from "@/lib/slugs";
import { serverEnv } from "@/lib/env";
import type { Host } from "@prisma/client";

// Returns the Supabase Auth user for the current request, or null if signed out.
// React.cache memoises within a single request so multiple callers (middleware,
// page-context, route handlers) share one auth round-trip.
export const getCurrentAuthUser = cache(async (): Promise<User | null> => {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data.user;
});

// Returns the Host row for the current signed-in user. Memoised per-request — pages that
// call getPageContextOrRedirect AND a permissions helper (which also calls getCurrentHost)
// only hit the DB once.
export const getCurrentHost = cache(async (): Promise<Host | null> => {
  const user = await getCurrentAuthUser();
  if (!user) return null;
  return prisma.host.findUnique({ where: { authUserId: user.id } });
});

// Extracts the lowercase email domain ("foo@acme.com" → "acme.com"). Returns null for inputs
// without an @. Used by the multi-tenant workspace lookup.
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

// Legacy single-tenant check — true when the email's domain matches the env-var seed domain.
// Kept only for the first-install bootstrap path; routine sign-in resolves the workspace by
// looking up Workspace.primaryEmailDomain instead.
export function isWorkspaceDomain(email: string): boolean {
  const env = serverEnv();
  const domain = domainOf(email);
  const seed = env.WORKSPACE_PRIMARY_EMAIL_DOMAIN?.toLowerCase();
  if (!domain || !seed) return false;
  return domain === seed;
}

// Parses SUPER_ADMIN_EMAILS into a normalised lowercase set.
function superAdminEmails(): Set<string> {
  const raw = serverEnv().SUPER_ADMIN_EMAILS ?? "";
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

export function isSuperAdminEmail(email: string): boolean {
  return superAdminEmails().has(email.toLowerCase());
}

// Idempotently creates the Host row for a freshly authenticated user, capturing the Google
// refresh token so the availability engine can call freebusy on their behalf.
//
// `sessionRefreshToken` is what Supabase returns from `exchangeCodeForSession` — the most
// reliable source. Falls back to `auth.identities.identity_data.provider_refresh_token` (older
// Supabase versions stash it there). Both can be null on subsequent sign-ins where Google
// doesn't re-issue a refresh token.
//
// Does NOT create memberships — that's workspace.ts's job, since the rules differ for
// @soul.com vs external collaborators.
export async function ensureHostFromAuthUser(
  user: User,
  sessionRefreshToken: string | null = null,
): Promise<Host> {
  const email = user.email;
  if (!email) throw new Error("Auth user has no email");

  const refreshToken = sessionRefreshToken ?? (await getGoogleRefreshTokenForAuthUser(user.id));
  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    email.split("@")[0];

  // Sync the super-admin flag from SUPER_ADMIN_EMAILS on every sign-in so removing an email
  // from the env var revokes admin access on next visit. Adding an email grants it.
  const shouldBeSuperAdmin = isSuperAdminEmail(email);

  const existing = await prisma.host.findUnique({ where: { authUserId: user.id } });
  if (existing) {
    const patch: { googleRefreshToken?: string; isSuperAdmin?: boolean } = {};
    // Refresh the cached token whenever Supabase has a new one. Don't clobber a good token with null.
    if (refreshToken && refreshToken !== existing.googleRefreshToken) {
      patch.googleRefreshToken = refreshToken;
    }
    if (existing.isSuperAdmin !== shouldBeSuperAdmin) {
      patch.isSuperAdmin = shouldBeSuperAdmin;
    }
    if (Object.keys(patch).length > 0) {
      return prisma.host.update({ where: { id: existing.id }, data: patch });
    }
    return existing;
  }

  // Seed inserts placeholder Host rows (e.g. owner sjoerd@soul.com with a fake authUserId) so
  // workspace ownership and demo data exist before anyone signs in. On first real sign-in, claim
  // the row by linking it to the real Supabase auth user.
  const claimable = await prisma.host.findUnique({ where: { email } });
  if (claimable) {
    return prisma.host.update({
      where: { id: claimable.id },
      data: {
        authUserId: user.id,
        name: claimable.name || name,
        googleRefreshToken: refreshToken ?? claimable.googleRefreshToken,
        isSuperAdmin: shouldBeSuperAdmin,
      },
    });
  }

  const slug = await generateUniqueSlug(name);
  return prisma.host.create({
    data: {
      authUserId: user.id,
      email,
      name,
      slug,
      googleRefreshToken: refreshToken,
      isSuperAdmin: shouldBeSuperAdmin,
    },
  });
}
