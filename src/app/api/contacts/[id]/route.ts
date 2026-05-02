import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Editable contact fields. `email` is the unique key per workspace and stays read-only.
// `name` is editable so admins can correct typos from booking-time entries.
const bodySchema = z.object({
  name: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  company: z.string().trim().max(120).nullable(),
  jobTitle: z.string().trim().max(120).nullable(),
  linkedinUrl: z
    .string()
    .trim()
    .max(300)
    .url()
    .startsWith("https://")
    .nullable()
    .or(z.literal("").transform(() => null)),
  location: z.string().trim().max(120).nullable(),
  timeZone: z.string().trim().max(80).nullable(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Workspace-scoped: the contact must belong to the caller's workspace.
  const member = await prisma.workspaceMember.findFirst({
    where: { hostId: host.id },
    select: { workspaceId: true },
  });
  if (!member) return new NextResponse("forbidden", { status: 403 });

  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return new NextResponse("Not found", { status: 404 });
  if (contact.workspaceId !== member.workspaceId) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  await prisma.contact.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}
