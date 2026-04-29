import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  logoUrl: z.string().url().startsWith("https://").nullable(),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getWorkspaceRole(host);
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }

  await prisma.workspace.update({
    where: { id: membership.workspaceId },
    data: { logoUrl: parsed.data.logoUrl, brandColor: parsed.data.brandColor },
  });

  return NextResponse.json({ ok: true });
}
