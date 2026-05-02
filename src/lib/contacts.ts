import { prisma } from "@/lib/prisma";

/**
 * Resolve the workspace id for a meeting type. PERSONAL meeting types live on a host —
 * we use that host's workspace membership. PROJECT meeting types live on a project —
 * the project owns its workspace directly.
 *
 * Returns null when nothing maps (e.g. a personal meeting type whose host has no workspace);
 * callers should silently skip Contact upsert in that case so they never break booking writes.
 */
export async function workspaceIdForMeetingType(meetingTypeId: string): Promise<string | null> {
  const mt = await prisma.meetingType.findUnique({
    where: { id: meetingTypeId },
    select: { scope: true, hostId: true, projectId: true },
  });
  if (!mt) return null;
  if (mt.scope === "PROJECT" && mt.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: mt.projectId },
      select: { workspaceId: true },
    });
    return project?.workspaceId ?? null;
  }
  if (mt.scope === "PERSONAL" && mt.hostId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { hostId: mt.hostId },
      select: { workspaceId: true },
    });
    return member?.workspaceId ?? null;
  }
  return null;
}

/**
 * Auto-build the workspace contact directory from booking traffic. Called after every
 * `prisma.booking.create` — wrapped in try/catch by the caller so a Contact write never
 * fails the surrounding booking transaction.
 *
 * Semantics:
 *   - First sighting: insert with name/timeZone seeded from the booking.
 *   - Subsequent sightings: only fill `name` / `timeZone` if they are still null. Manually
 *     edited fields (phone, company, jobTitle, linkedinUrl, location, plus name/timeZone if
 *     the user has set them) are never overwritten.
 */
export async function upsertContactFromBooking(args: {
  workspaceId: string;
  email: string;
  name: string | null;
  timeZone: string | null;
}): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email) return;

  // Use a single round-trip upsert. The `update` clause never touches name/timeZone — we top
  // those up below only if they're still null. (Postgres can't conditionally COALESCE inside
  // upsert with Prisma's typed API without raw SQL, so we do the read-then-fill explicitly.)
  await prisma.contact.upsert({
    where: { workspaceId_email: { workspaceId: args.workspaceId, email } },
    create: {
      workspaceId: args.workspaceId,
      email,
      name: args.name,
      timeZone: args.timeZone,
    },
    update: {},
  });

  if (args.name || args.timeZone) {
    const existing = await prisma.contact.findUnique({
      where: { workspaceId_email: { workspaceId: args.workspaceId, email } },
      select: { name: true, timeZone: true },
    });
    if (!existing) return;
    const patch: { name?: string; timeZone?: string } = {};
    if (!existing.name && args.name) patch.name = args.name;
    if (!existing.timeZone && args.timeZone) patch.timeZone = args.timeZone;
    if (Object.keys(patch).length > 0) {
      await prisma.contact.update({
        where: { workspaceId_email: { workspaceId: args.workspaceId, email } },
        data: patch,
      });
    }
  }
}
