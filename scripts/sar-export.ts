// GDPR Subject Access Request (SAR) export.
//
// Dumps every Soul Suite record that mentions a given email address as JSON,
// suitable for fulfilling an Art. 15 right-of-access request.
//
// Usage:
//   npx tsx scripts/sar-export.ts <email> [--out <file.json>]
//
// The same logic is exposed via POST /api/admin/sar-export for browser-based
// use by workspace OWNERs. See docs/GDPR_SAR.md.
//
// This file is intentionally read-only. For erasure, see scripts/sar-erase.ts.

import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

export type SarExport = {
  meta: {
    generatedAt: string;
    queriedEmail: string;
    rowCounts: Record<string, number>;
  };
  hosts: unknown[];
  bookings: unknown[];
  pollResponses: unknown[];
  invites: unknown[];
  workspaceMemberships: unknown[];
  projectMemberships: unknown[];
  meetingTypes: unknown[];
};

// Case-insensitive equality helper for Postgres `String` columns.
function emailFilter(email: string) {
  return { equals: email, mode: "insensitive" as const };
}

export async function buildSarExport(rawEmail: string): Promise<SarExport> {
  const email = rawEmail.trim().toLowerCase();

  // ── Hosts (matched on Host.email)
  const hostRows = await prisma.host.findMany({
    where: { email: emailFilter(email) },
    include: {
      workspaceMembers: { include: { workspace: { select: { id: true, name: true, slug: true } } } },
      projectMembers: { include: { project: { select: { id: true, name: true, slug: true } } } },
      personalMeetingTypes: {
        select: {
          id: true,
          slug: true,
          name: true,
          scope: true,
          durationMinutes: true,
          isActive: true,
          createdAt: true,
        },
      },
    },
  });

  const hosts = hostRows.map((h) => ({
    id: h.id,
    email: h.email,
    name: h.name,
    slug: h.slug,
    timezone: h.timezone,
    phone: h.phone,
    location: h.location,
    bio: h.bio,
    photoUrl: h.photoUrl,
    zoomAccountEmail: h.zoomAccountEmail,
    zoomConnectedAt: h.zoomConnectedAt,
    googleRefreshToken: h.googleRefreshToken ? "present" : "absent",
    zoomRefreshToken: h.zoomRefreshToken ? "present" : "absent",
    createdAt: h.createdAt,
  }));

  const workspaceMemberships = hostRows.flatMap((h) =>
    h.workspaceMembers.map((m) => ({
      hostId: h.id,
      workspaceId: m.workspaceId,
      workspaceName: m.workspace.name,
      workspaceSlug: m.workspace.slug,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  );

  const projectMemberships = hostRows.flatMap((h) =>
    h.projectMembers.map((m) => ({
      hostId: h.id,
      projectId: m.projectId,
      projectName: m.project.name,
      projectSlug: m.project.slug,
      role: m.role,
      isExternal: m.isExternal,
      addedAt: m.addedAt,
      lastAssignedAt: m.lastAssignedAt,
    })),
  );

  const meetingTypes = hostRows.flatMap((h) =>
    h.personalMeetingTypes.map((mt) => ({
      hostId: h.id,
      id: mt.id,
      slug: mt.slug,
      name: mt.name,
      scope: mt.scope,
      durationMinutes: mt.durationMinutes,
      isActive: mt.isActive,
      createdAt: mt.createdAt,
    })),
  );

  // ── Bookings (matched on Booking.inviteeEmail)
  const bookingRows = await prisma.booking.findMany({
    where: { inviteeEmail: emailFilter(email) },
    include: {
      host: { select: { name: true, email: true } },
      meetingType: { select: { name: true, slug: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  const bookings = bookingRows.map((b) => ({
    id: b.id,
    hostName: b.host?.name ?? null,
    meetingTypeName: b.meetingType?.name ?? null,
    meetingTypeSlug: b.meetingType?.slug ?? null,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    inviteeName: b.inviteeName,
    inviteeEmail: b.inviteeEmail,
    inviteeAnswers: b.inviteeAnswers,
    status: b.status,
    createdAt: b.createdAt,
  }));

  // ── PollResponses (matched on PollResponse.inviteeEmail)
  const pollResponseRows = await prisma.pollResponse.findMany({
    where: { inviteeEmail: emailFilter(email) },
    include: { poll: { select: { name: true, status: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const pollResponses = pollResponseRows.map((r) => ({
    id: r.id,
    pollId: r.pollId,
    pollName: r.poll?.name ?? null,
    pollStatus: r.poll?.status ?? null,
    inviteeEmail: r.inviteeEmail,
    votes: r.votes,
    respondedAt: r.updatedAt,
    createdAt: r.createdAt,
  }));

  // ── Invites (matched on Invite.email)
  const inviteRows = await prisma.invite.findMany({
    where: { email: emailFilter(email) },
    orderBy: { createdAt: "desc" },
  });

  const invites = inviteRows.map((i) => ({
    id: i.id,
    kind: i.kind,
    role: i.role,
    email: i.email,
    workspaceId: i.workspaceId,
    projectId: i.projectId,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    acceptedAt: i.acceptedAt,
  }));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      queriedEmail: email,
      rowCounts: {
        hosts: hosts.length,
        workspaceMemberships: workspaceMemberships.length,
        projectMemberships: projectMemberships.length,
        meetingTypes: meetingTypes.length,
        bookings: bookings.length,
        pollResponses: pollResponses.length,
        invites: invites.length,
      },
    },
    hosts,
    workspaceMemberships,
    projectMemberships,
    meetingTypes,
    bookings,
    pollResponses,
    invites,
  };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0].startsWith("--")) {
    console.error("Usage: tsx scripts/sar-export.ts <email> [--out <file.json>]");
    process.exit(1);
  }
  const email = argv[0];
  let outFile: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      outFile = argv[i + 1];
      i++;
    }
  }

  const result = await buildSarExport(email);
  const json = JSON.stringify(result, null, 2);

  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`SAR export written to ${outFile}`);
    console.error(`Row counts: ${JSON.stringify(result.meta.rowCounts)}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

// Only execute when invoked directly, not when imported by the API route.
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("sar-export.ts") || entry.endsWith("sar-export.js");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
