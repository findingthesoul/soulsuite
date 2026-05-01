import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

// Refreshes the Supabase auth cookie on auth-required requests. We skip the network call
// for public paths (booking flow, poll voting, invite landing, .ics feeds) because each
// `getUser()` is a JWT verify + occasional refresh network hop to Supabase, and the public
// pages don't read the user from cookies anyway. Saves ~50–200 ms on every public hit.

const AUTH_REQUIRED_PREFIXES: readonly string[] = [
  "/dashboard",
  "/settings",
  "/onboarding",
  "/auth",
  "/request-access",
  "/api/settings",
  "/api/projects",
  "/api/meeting-types",
];

function needsSession(pathname: string): boolean {
  return AUTH_REQUIRED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!needsSession(request.nextUrl.pathname)) {
    return response;
  }

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
