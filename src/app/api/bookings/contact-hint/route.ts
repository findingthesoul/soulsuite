// GET /api/bookings/contact-hint?meetingTypeId=...&email=...
//
// Public lookup used by the booking page to prefill the billing form when the invitee's email
// matches an existing Contact in the host's workspace. Returns ONLY name + company — never
// addresses, VAT, or anything that would expose PII to email-enumeration. Address fields are
// recovered (when applicable) from the invitee's localStorage on their own browser; this server
// path covers the cross-device "I know I work at Acme" case without leaking street addresses.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { workspaceIdForMeetingType } from "@/lib/contacts";

const querySchema = z.object({
  meetingTypeId: z.string().min(1),
  email: z.string().email().max(200),
});

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    meetingTypeId: sp.get("meetingTypeId"),
    email: sp.get("email"),
  });
  if (!parsed.success) {
    return NextResponse.json({ name: null, company: null });
  }

  const workspaceId = await workspaceIdForMeetingType(parsed.data.meetingTypeId);
  if (!workspaceId) return NextResponse.json({ name: null, company: null });

  const contact = await prisma.contact.findUnique({
    where: {
      workspaceId_email: {
        workspaceId,
        email: parsed.data.email.trim().toLowerCase(),
      },
    },
    select: { name: true, company: true },
  });

  return NextResponse.json({
    name: contact?.name ?? null,
    company: contact?.company ?? null,
  });
}
