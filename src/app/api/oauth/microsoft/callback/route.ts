import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import {
  exchangeCodeForToken,
  fetchMicrosoftUser,
  MICROSOFT_REDIRECT_PATH,
} from "@/lib/microsoft/client";
import { publicEnv } from "@/lib/env";

const STATE_COOKIE = "microsoft_oauth_state";

export async function GET(req: Request) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.redirect(new URL("/auth/signin", process.env.NEXT_PUBLIC_APP_URL!));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/settings/connections", process.env.NEXT_PUBLIC_APP_URL!);

  if (error) {
    settingsUrl.searchParams.set("microsoft_error", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || !state) {
    settingsUrl.searchParams.set("microsoft_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  if (!expected || expected !== state) {
    settingsUrl.searchParams.set("microsoft_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const redirectUri = `${publicEnv.NEXT_PUBLIC_APP_URL}${MICROSOFT_REDIRECT_PATH}`;
    const tokens = await exchangeCodeForToken(code, redirectUri);
    const msUser = await fetchMicrosoftUser(tokens.accessToken);
    await prisma.host.update({
      where: { id: host.id },
      data: {
        microsoftRefreshToken: tokens.refreshToken,
        microsoftAccountEmail: msUser.email,
        microsoftConnectedAt: new Date(),
      },
    });
    settingsUrl.searchParams.set("microsoft_connected", "1");
  } catch (err) {
    console.error("[microsoft oauth]", err);
    settingsUrl.searchParams.set("microsoft_error", "exchange_failed");
  }

  const res = NextResponse.redirect(settingsUrl);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
