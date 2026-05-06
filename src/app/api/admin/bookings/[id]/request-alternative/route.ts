// Authenticated admin endpoint for the third option on PENDING_APPROVAL bookings: cancel the
// request and email the invitee asking them to pick a different time. Optional free-text
// comment from the host is included verbatim in the email.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentHost } from "@/lib/auth";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";
import { requestAlternativeForPendingBooking } from "@/lib/bookings/approve";

const bodySchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const access = await authorizeAdminBookingAction(caller, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }

  const result = await requestAlternativeForPendingBooking({
    bookingId: id,
    decidedByHostId: caller.id,
    comment: parsed.data.comment?.trim() || null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
