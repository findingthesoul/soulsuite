import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { getWorkspaceRole } from "@/lib/permissions";
import { buildSarExport } from "../../../../../scripts/sar-export";

// POST /api/admin/sar-export
// Body: { email: string }
// Auth: workspace OWNER only.
//
// Returns the same JSON document the CLI script produces, with an attachment
// Content-Disposition so the browser saves it. See docs/GDPR_SAR.md.
const bodySchema = z.object({
  email: z.string().email().max(320),
});

function emailToSlug(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await getWorkspaceRole(host);
  if (!membership || membership.role !== "OWNER") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const result = await buildSarExport(parsed.data.email);
  const body = JSON.stringify(result, null, 2);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `sar-export-${emailToSlug(parsed.data.email)}-${date}.json`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
