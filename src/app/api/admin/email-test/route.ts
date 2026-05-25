// POST /api/admin/email-test  { to: string }
//
// Super-admin-only. Fires sendEmail() to the given address with a minimal payload and returns
// the wrapper's { ok, reason } response. An EmailLog row is written as a side-effect via the
// sendEmail wrapper itself, so the diagnostics page can show the attempt on refresh.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const bodySchema = z.object({
  to: z.string().email(),
});

export async function POST(request: NextRequest) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!caller.isSuperAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const stamp = new Date().toISOString();
  const result = await sendEmail({
    to: parsed.data.to,
    subject: `Soul Suite email diagnostics test — ${stamp}`,
    html:
      `<p>This is a test email from <strong>Soul Suite</strong> diagnostics.</p>` +
      `<p>If you can read this, Resend accepted the send and your inbox received it.</p>` +
      `<p style="color:#a8a29e;font-size:12px;margin-top:24px">Sent at ${stamp} by ${caller.email}.</p>`,
    text: `Soul Suite email diagnostics test sent at ${stamp} by ${caller.email}.`,
  });

  return NextResponse.json({ ok: result.ok, reason: result.reason ?? null });
}
