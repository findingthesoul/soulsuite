import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { getProjectMembership, canManageProject } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertSlugAvailable, normaliseSlug, SlugError } from "@/lib/slugs";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
  isActive: z.boolean(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getProjectMembership(host, id);
  if (!membership || !canManageProject(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return new NextResponse("Project not found", { status: 404 });

  const json = await request.json();
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const slug = normaliseSlug(parsed.data.slug);
  if (slug !== project.slug) {
    try {
      await assertSlugAvailable(slug);
    } catch (err) {
      if (err instanceof SlugError) return new NextResponse(err.message, { status: 409 });
      throw err;
    }
  }

  await prisma.project.update({
    where: { id },
    data: {
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      isActive: parsed.data.isActive,
    },
  });
  return NextResponse.json({ ok: true });
}
