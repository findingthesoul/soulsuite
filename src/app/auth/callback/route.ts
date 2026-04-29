import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureHostFromAuthUser } from "@/lib/auth";
import { resolvePostSignIn, hostHasCompletedOnboarding } from "@/lib/workspace";

// Supabase Auth redirects here with `?code=...` after Google OAuth. We exchange the code
// for a session, ensure a Host row exists (capturing the Google refresh token), then route
// based on the workspace bootstrap outcome.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(errorParam)}`, url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/auth/signin", url));
  }

  const supabase = await createSupabaseServerClient();
  const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(exchangeError.message)}`, url));
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.redirect(new URL("/auth/error?reason=no-user", url));
  }

  // Google's refresh token is only present in the session at exchange time — it's not persisted
  // in auth.identities. Capture it here and pass it through so we can store it on the Host row.
  const session = exchangeData.session as
    | { provider_token?: string | null; provider_refresh_token?: string | null }
    | null;
  const providerRefreshToken = session?.provider_refresh_token ?? null;
  // eslint-disable-next-line no-console
  console.log("[auth/callback] tokens", {
    hasProviderToken: !!session?.provider_token,
    hasProviderRefreshToken: !!providerRefreshToken,
    sessionKeys: session ? Object.keys(session) : null,
  });

  const host = await ensureHostFromAuthUser(userData.user, providerRefreshToken);
  const outcome = await resolvePostSignIn(host);

  switch (outcome.kind) {
    case "rejected":
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL(`/auth/error?reason=${encodeURIComponent(outcome.reason)}`, url),
      );
    case "needs-access-request":
      return NextResponse.redirect(new URL("/request-access", url));
    case "external-collaborator":
      return NextResponse.redirect(new URL("/dashboard", url));
    case "needs-onboarding":
    case "ready": {
      const done = await hostHasCompletedOnboarding(outcome.host);
      return NextResponse.redirect(new URL(done ? "/dashboard" : "/onboarding/calendars", url));
    }
  }
}
