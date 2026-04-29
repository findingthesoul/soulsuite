import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

// Service-role client. Bypasses RLS — use ONLY server-side, ONLY when needed (e.g. reading auth.identities
// to extract the Google refresh token, or admin tasks). Never expose this client to the browser.
export function createSupabaseServiceClient() {
  const env = serverEnv();
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Pulls the Google refresh token Supabase Auth stashed during OAuth.
// Path: auth.identities.identity_data.provider_refresh_token (set when "offline access" is enabled).
export async function getGoogleRefreshTokenForAuthUser(authUserId: string): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.auth.admin.getUserById(authUserId);
  if (error || !data.user) return null;

  const identity = data.user.identities?.find((i) => i.provider === "google");
  if (!identity) return null;

  // identity_data is loosely typed by the SDK. The relevant field is provider_refresh_token.
  const idData = identity.identity_data as Record<string, unknown> | undefined;
  const refresh = idData?.provider_refresh_token;
  return typeof refresh === "string" && refresh.length > 0 ? refresh : null;
}
