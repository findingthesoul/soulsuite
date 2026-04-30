import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { exchangeCodeForTokens, fetchZoomUser } from "@/lib/zoom/client";

const STATE_COOKIE = "zoom_oauth_state";

export async function GET(req: Request) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.redirect(new URL("/auth/signin", process.env.NEXT_PUBLIC_APP_URL!));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/settings/connections", process.env.NEXT_PUBLIC_APP_URL!);

  if (error) {
    settingsUrl.searchParams.set("zoom_error", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || !state) {
    settingsUrl.searchParams.set("zoom_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  if (!expected || expected !== state) {
    settingsUrl.searchParams.set("zoom_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const zoomUser = await fetchZoomUser(tokens.accessToken);
    await prisma.host.update({
      where: { id: host.id },
      data: {
        zoomRefreshToken: tokens.refreshToken,
        zoomAccountEmail: zoomUser.email,
        zoomConnectedAt: new Date(),
      },
    });
    settingsUrl.searchParams.set("zoom_connected", "1");
  } catch (err) {
    console.error("[zoom oauth]", err);
    settingsUrl.searchParams.set("zoom_error", "exchange_failed");
  }

  const res = NextResponse.redirect(settingsUrl);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
