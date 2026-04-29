import type { User } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGoogleRefreshTokenForAuthUser } from "@/lib/supabase/service";
import { generateUniqueSlug } from "@/lib/slugs";
import { serverEnv } from "@/lib/env";
import type { Host } from "@prisma/client";

// Returns the Supabase Auth user for the current request, or null if signed out.
export async function getCurrentAuthUser(): Promise<User | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data.user;
}

// Returns the Host row for the current signed-in user. Will NOT create one — use
// ensureHostFromAuthUser in the OAuth callback for that, where we have the refresh token.
export async function getCurrentHost(): Promise<Host | null> {
  const user = await getCurrentAuthUser();
  if (!user) return null;
  return prisma.host.findUnique({ where: { authUserId: user.id } });
}

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
// Does NOT create memberships — that's workspace.ts's job, since the rules differ for
// @soul.com vs external collaborators.
export async function ensureHostFromAuthUser(user: User): Promise<Host> {
  const email = user.email;
  if (!email) throw new Error("Auth user has no email");

  const refreshToken = await getGoogleRefreshTokenForAuthUser(user.id);
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
