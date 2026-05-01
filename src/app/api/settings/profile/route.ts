import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(120).nullable(),
  bio: z.string().max(1000).nullable(),
  photoUrl: z.string().url().startsWith("https://").nullable(),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  await prisma.host.update({
    where: { id: host.id },
    data: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
