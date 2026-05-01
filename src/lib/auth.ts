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

// Domain check used during workspace + project bootstrap. Compares the email's host part
// (case-insensitive) to WORKSPACE_PRIMARY_EMAIL_DOMAIN.
export function isWorkspaceDomain(email: string): boolean {
  const env = serverEnv();
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === env.WORKSPACE_PRIMARY_EMAIL_DOMAIN.toLowerCase();
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

  const existing = await prisma.host.findUnique({ where: { authUserId: user.id } });
  if (existing) {
    // Refresh the cached token whenever Supabase has a new one. Don't clobber a good token with null.
    if (refreshToken && refreshToken !== existing.googleRefreshToken) {
      return prisma.host.update({
        where: { id: existing.id },
        data: { googleRefreshToken: refreshToken },
      });
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
    },
  });
}
