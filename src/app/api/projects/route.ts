import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ProjectRole } from "@prisma/client";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertSlugAvailable, normaliseSlug, SlugError } from "@/lib/slugs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  description: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Brief §3: any workspace member can create a project. External collaborators can't.
  const membership = await getWorkspaceRole(host);
  if (!membership) {
    return new NextResponse("Only workspace members can create projects.", { status: 403 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const slug = normaliseSlug(parsed.data.slug);

  try {
    const project = await prisma.$transaction(async (tx) => {
      // Slug uniqueness vs. reserved + Host slugs + other Project slugs.
      await assertSlugAvailable(slug, tx);

      const created = await tx.project.create({
        data: {
          workspaceId: membership.workspaceId,
          slug,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
        },
      });
      // Creator becomes the first LEAD.
      await tx.projectMember.create({
        data: {
          projectId: created.id,
          hostId: host.id,
          role: ProjectRole.LEAD,
          isExternal: false,
        },
      });
      return created;
    });
    return NextResponse.json({ id: project.id, slug: project.slug });
  } catch (err) {
    if (err instanceof SlugError) return new NextResponse(err.message, { status: 409 });
    throw err;
  }
}
