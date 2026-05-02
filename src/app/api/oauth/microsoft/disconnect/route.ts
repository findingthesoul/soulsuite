import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { clearMicrosoftTokenCache } from "@/lib/microsoft/host";

// Drops the host's Microsoft credentials. Existing meeting types still on
// `conferencingProvider=TEAMS` will fail to create new bookings until the host reconnects
// (or switches the provider).
export async function POST() {
  const host = await getCurrentHost();
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.host.update({
    where: { id: host.id },
    data: {
      microsoftRefreshToken: null,
      microsoftAccountEmail: null,
      microsoftConnectedAt: null,
    },
  });
  clearMicrosoftTokenCache(host.id);
  return NextResponse.json({ ok: true });
}
