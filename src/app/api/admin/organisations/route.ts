// POST /api/admin/organisations
//
// Super-admin endpoint to provision a new workspace (tenant). Required:
//   - name: human-readable workspace name
//   - slug: URL slug, unique across workspaces
//   - primaryEmailDomain: lowercase domain string, unique across workspaces
// Optional:
//   - ownerEmail: when set, either looks up an existing Host with that email and promotes
//     them to OWNER, or creates a placeholder Host that will be claimed on first sign-in.
//     When omitted, no membership rows are created — the first sign-in from the domain falls
//     through the bootstrap path which doesn't create members (so the domain remains empty
//     until a member is added). Pass an ownerEmail in production.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateUniqueSlug } from "@/lib/slugs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  primaryEmailDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, "Domain looks invalid (e.g. acme.com)."),
  ownerEmail: z.string().email().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!caller.isSuperAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const data = parsed.data;

  if (data.ownerEmail && !data.ownerEmail.toLowerCase().endsWith(`@${data.primaryEmailDomain}`)) {
    return new NextResponse(
      `Owner email must be on @${data.primaryEmailDomain}.`,
      { status: 400 },
    );
  }

  // Slug uniqueness is enforced by the unique constraint; check up front for a friendlier error.
  const slugClash = await prisma.workspace.findUnique({ where: { slug: data.slug } });
  if (slugClash) {
    return new NextResponse(`Slug "${data.slug}" is already taken.`, { status: 409 });
  }
  const domainClash = await prisma.workspace.findUnique({
    where: { primaryEmailDomain: data.primaryEmailDomain },
  });
  if (domainClash) {
    return new NextResponse(
      `An organisation already owns @${data.primaryEmailDomain}.`,
      { status: 409 },
    );
  }

  try {
    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: data.name,
          slug: data.slug,
          primaryEmailDomain: data.primaryEmailDomain,
        },
      });
      if (data.ownerEmail) {
        // Either claim an existing host (no membership yet on this workspace) or create a
        // placeholder Host with a deterministic-but-unique authUserId. The real auth user
        // claims it on first sign-in (see ensureHostFromAuthUser's `claimable` path).
        const ownerEmail = data.ownerEmail.toLowerCase();
        let ownerHost = await tx.host.findUnique({ where: { email: ownerEmail } });
        if (!ownerHost) {
          const slug = await generateUniqueSlug(ownerEmail.split("@")[0]);
          ownerHost = await tx.host.create({
            data: {
              authUserId: `placeholder-${ws.id}-${Date.now()}`,
              email: ownerEmail,
              name: ownerEmail.split("@")[0],
              slug,
            },
          });
        }
        await tx.workspaceMember.create({
          data: { workspaceId: ws.id, hostId: ownerHost.id, role: "OWNER" },
        });
      }
      return ws;
    });
    return NextResponse.json({ ok: true, id: workspace.id });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return new NextResponse("That slug or domain is already taken.", { status: 409 });
    }
    throw err;
  }
}
