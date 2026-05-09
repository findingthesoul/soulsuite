"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { CenterShell } from "@/components/app-shell";

// Calendar scopes per the brief. `calendar.events` covers read+write; `freebusy` is implied.
// `offline_access` makes Google return a refresh token, which Supabase persists in auth.identities.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export default function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: {
          // Asks Google to issue a refresh token. We only get one back the first time the
          // user consents (or after they revoke and re-grant); on subsequent sign-ins Google
          // skips it because the previous grant is still valid — and we already persisted the
          // refresh token on the Host row, so that's fine.
          access_type: "offline",
          // `select_account` forces Google to show the account chooser every sign-in so users
          // can switch Google accounts after sign-out. We deliberately do NOT add `consent` —
          // that would re-show the calendar-permission prompt on every sign-in, which is
          // jarring once the user has already authorised. If the stored refresh token becomes
          // invalid (revoked / 7-day-test-user expiry), /settings/calendars detects it and
          // sends the user through a one-shot reconnect flow.
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <CenterShell>
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold">
            S
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Soul Suite</h1>
          <p className="text-sm text-muted-foreground">Sign in with your Google account.</p>
        </div>
        <Button onClick={handleSignIn} disabled={busy} className="w-full" size="lg">
          {busy ? "Redirecting…" : "Continue with Google"}
        </Button>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <p className="text-xs text-muted-foreground text-center">
          Workspace members must use an @soul.com account. External collaborators need a project invite.
        </p>
      </div>
    </CenterShell>
  );
}
