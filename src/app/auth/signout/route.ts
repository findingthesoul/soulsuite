import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const sb = await createSupabaseServerClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/auth/signin", request.url));
}
