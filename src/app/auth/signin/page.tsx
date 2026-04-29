"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";

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
          // Forces Google to issue a refresh token even on subsequent sign-ins.
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Soul Suite</h1>
          <p className="text-sm text-neutral-500">Sign in with your Google account.</p>
        </div>
        <button
          onClick={handleSignIn}
          disabled={busy}
          className="w-full rounded-lg bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-neutral-500 text-center">
          Workspace members must use an @soul.com account. External collaborators need a project invite.
        </p>
      </div>
    </main>
  );
}
