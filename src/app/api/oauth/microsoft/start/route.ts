import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getCurrentHost } from "@/lib/auth";
import { isMicrosoftConfigured, microsoftAuthorizeUrl } from "@/lib/microsoft/client";

// Kicks off the Microsoft Graph OAuth flow. The browser navigates here from
// /settings/connections; we set a CSRF state cookie and 302 to Microsoft's authorize endpoint.
const STATE_COOKIE = "microsoft_oauth_state";

export async function GET() {
  const host = await getCurrentHost();
  if (!host) return NextResponse.redirect(new URL("/auth/signin", process.env.NEXT_PUBLIC_APP_URL!));
  if (!isMicrosoftConfigured()) {
    return NextResponse.json(
      { error: "Microsoft is not configured on this server." },
      { status: 500 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const url = microsoftAuthorizeUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  await cookies();
  return res;
}
