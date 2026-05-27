// PATCH /api/settings/theme  { mode: "LIGHT" | "DARK" | "SYSTEM" }
//
// Stores the host's theme preference on their Host row. The client also writes localStorage
// so first paint is correct without a server roundtrip; this endpoint just makes the choice
// stick across browsers / devices / fresh sign-ins.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  mode: z.enum(["LIGHT", "DARK", "SYSTEM"]),
});

export async function PATCH(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  await prisma.host.update({
    where: { id: host.id },
    data: { themePreference: parsed.data.mode },
  });
  return NextResponse.json({ ok: true });
}
