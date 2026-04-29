import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertSlugAvailable, normaliseSlug, SlugError } from "@/lib/slugs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  primaryEmailDomain: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/),
});

export async function PATCH(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getWorkspaceRole(host);
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const slug = normaliseSlug(parsed.data.slug);
  if (slug !== membership.workspace.slug) {
    // Slug actually changing — verify it's not reserved or owned by another host/project.
    try {
      await assertSlugAvailable(slug);
    } catch (err) {
      if (err instanceof SlugError) return new NextResponse(err.message, { status: 409 });
      throw err;
    }
  }

  await prisma.workspace.update({
    where: { id: membership.workspaceId },
    data: {
      name: parsed.data.name,
      slug,
      primaryEmailDomain: parsed.data.primaryEmailDomain,
    },
  });
  return NextResponse.json({ ok: true });
}
