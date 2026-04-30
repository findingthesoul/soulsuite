// Seed: creates the Soul workspace, two demo hosts, one project, two meeting types,
// and reserved route slugs. Demo hosts have no real Google credentials, so booking flows
// against them won't reach Google — they exist for UI/permissions exploration only.

import { PrismaClient, WorkspaceRole, ProjectRole, Scope, RoutingMode, CalendarRole } from "@prisma/client";
import { RESERVED_SLUGS } from "../src/lib/slugs.constants";

const prisma = new PrismaClient();

async function main() {
  // Reserved slugs — block routes that would collide with app paths.
  await prisma.reservedSlug.createMany({
    data: RESERVED_SLUGS.map((value) => ({ value })),
    skipDuplicates: true,
  });

  // Soul workspace.
  const workspace = await prisma.workspace.upsert({
    where: { slug: "soul" },
    update: {},
    create: {
      name: "Soul",
      slug: "soul",
      primaryEmailDomain: "soul.com",
    },
  });

  // Demo host A — workspace owner.
  const hostA = await prisma.host.upsert({
    where: { email: "sjoerd@soul.com" },
    update: {},
    create: {
      authUserId: "seed-sjoerd",
      email: "sjoerd@soul.com",
      name: "Sjoerd",
      slug: "sjoerd",
      timezone: "Europe/Amsterdam",
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_hostId: { workspaceId: workspace.id, hostId: hostA.id } },
    update: { role: WorkspaceRole.OWNER },
    create: { workspaceId: workspace.id, hostId: hostA.id, role: WorkspaceRole.OWNER },
  });

  await prisma.calendar.upsert({
    where: { hostId_googleCalendarId: { hostId: hostA.id, googleCalendarId: "primary" } },
    update: {},
    create: {
      hostId: hostA.id,
      googleCalendarId: "primary",
      summary: "sjoerd@soul.com",
      role: CalendarRole.WRITE_TARGET,
    },
  });

  // Demo host B — external collaborator (different domain).
  const hostB = await prisma.host.upsert({
    where: { email: "guest@partner.example" },
    update: {},
    create: {
      authUserId: "seed-guest",
      email: "guest@partner.example",
      name: "Guest Partner",
      slug: "guest",
      timezone: "Europe/Amsterdam",
    },
  });

  // Project containing both — guest joins as external.
  const project = await prisma.project.upsert({
    where: { slug: "demo-project" },
    update: {},
    create: {
      workspaceId: workspace.id,
      slug: "demo-project",
      name: "Demo Project",
      description: "Demo engagement seeded by prisma/seed.ts",
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_hostId: { projectId: project.id, hostId: hostA.id } },
    update: {},
    create: { projectId: project.id, hostId: hostA.id, role: ProjectRole.LEAD, isExternal: false },
  });

  await prisma.projectMember.upsert({
    where: { projectId_hostId: { projectId: project.id, hostId: hostB.id } },
    update: {},
    create: { projectId: project.id, hostId: hostB.id, role: ProjectRole.MEMBER, isExternal: true },
  });

  // Personal meeting type on hostA.
  await prisma.meetingType.upsert({
    where: { hostId_slug: { hostId: hostA.id, slug: "intro-call" } },
    update: {},
    create: {
      scope: Scope.PERSONAL,
      hostId: hostA.id,
      slug: "intro-call",
      name: "Intro call",
      durationMinutes: 30,
      bufferAfterMinutes: 15,
      minNoticeMinutes: 120,
      maxAdvanceDays: 30,
      routingMode: RoutingMode.SINGLE,
      assignedHostIds: [hostA.id],
    },
  });

  // Project meeting type — single-host for now (round-robin needs both hosts to have working hours).
  await prisma.meetingType.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "kickoff" } },
    update: {},
    create: {
      scope: Scope.PROJECT,
      projectId: project.id,
      slug: "kickoff",
      name: "Project kickoff",
      durationMinutes: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minNoticeMinutes: 60 * 24,
      maxAdvanceDays: 60,
      routingMode: RoutingMode.SINGLE,
      assignedHostIds: [hostA.id],
    },
  });

  console.log("Seed complete:");
  console.log(`  workspace: ${workspace.slug}`);
  console.log(`  hosts:     ${hostA.email}, ${hostB.email}`);
  console.log(`  project:   ${project.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
