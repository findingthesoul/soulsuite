import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getCurrentHost } from "@/lib/auth";
import { isZoomConfigured, zoomAuthorizeUrl } from "@/lib/zoom/client";

// Kicks off the Zoom OAuth flow. The browser navigates here from /settings/connections;
// we set a CSRF state cookie and 302 to Zoom's authorize endpoint.
const STATE_COOKIE = "zoom_oauth_state";

export async function GET() {
  const host = await getCurrentHost();
  if (!host) return NextResponse.redirect(new URL("/auth/signin", process.env.NEXT_PUBLIC_APP_URL!));
  if (!isZoomConfigured()) {
    return NextResponse.json({ error: "Zoom is not configured on this server." }, { status: 500 });
  }

  const state = randomBytes(24).toString("hex");
  const url = zoomAuthorizeUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 min — enough for the user to complete the Zoom prompt
  });
  // Touch cookies() so Next picks up the request scope (avoids the "dynamic API used in
  // static context" warning when this runs at build-time route analysis).
  await cookies();
  return res;
}
