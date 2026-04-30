import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";

// Drops the host's Zoom credentials. Existing meeting types still on `conferencingProvider=ZOOM`
// will fail to create new bookings until the host reconnects (or switches the provider).
export async function POST() {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.host.update({
    where: { id: host.id },
    data: { zoomRefreshToken: null, zoomAccountEmail: null, zoomConnectedAt: null },
  });
  return NextResponse.json({ ok: true });
}
