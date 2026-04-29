import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";
import { isGoogleAuthError } from "@/lib/google/client";
import { BookingFlow } from "./flow";
import { RESERVED_SLUGS } from "@/lib/slugs.constants";

// Public booking page — no auth. URL pattern is shared between hosts and projects, so we
// resolve the first segment as a Host first, then fall back to Project (brief §"URL patterns").
//
// For project-scoped meeting types we look up the SINGLE assigned host's calendar + availability
// (round-robin lands in build-order step 10 / COLLECTIVE in backlog).
export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string; meetingTypeSlug: string }>;
}) {
  const { slug, meetingTypeSlug } = await params;
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) notFound();

  const resolved = await resolveMeetingTypeAndHost(slug, meetingTypeSlug);
  if (!resolved) notFound();

  const { host, meetingType, projectName, publicSlug } = resolved;

  const now = new Date();
  const range = {
    from: now,
    to: new Date(now.getTime() + meetingType.maxAdvanceDays * 24 * 3600 * 1000),
  };

  let slots: { startsAt: string; endsAt: string }[] = [];
  let needsHostReauth = false;
  try {
    const computed = await getAvailableSlotsForMeetingType(meetingType, host, range);
    slots = computed.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
  } catch (err) {
    if (isGoogleAuthError(err)) needsHostReauth = true;
    else throw err;
  }

  if (needsHostReauth) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Booking temporarily unavailable</h1>
          <p className="text-sm text-muted-foreground">
            {host.name} needs to reconnect their calendar. Please try again later.
          </p>
        </div>
      </main>
    );
  }

  return (
    <BookingFlow
      host={{ slug: publicSlug, name: host.name, timezone: host.timezone }}
      meetingType={{
        id: meetingType.id,
        slug: meetingType.slug,
        name: meetingType.name,
        description: meetingType.description,
        durationMinutes: meetingType.durationMinutes,
      }}
      projectName={projectName}
      initialSlots={slots}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Resolver: tries host slug first, then project slug
// ────────────────────────────────────────────────────────────

async function resolveMeetingTypeAndHost(slug: string, meetingTypeSlug: string) {
  // Path A: personal meeting type under a host slug.
  const host = await prisma.host.findUnique({
    where: { slug },
    include: { calendars: true },
  });
  if (host) {
    const meetingType = await prisma.meetingType.findFirst({
      where: { scope: "PERSONAL", hostId: host.id, slug: meetingTypeSlug, isActive: true },
    });
    if (!meetingType) return null;
    return { host, meetingType, projectName: null as string | null, publicSlug: host.slug };
  }

  // Path B: project meeting type under a project slug. We resolve the SINGLE assigned host.
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project || !project.isActive) return null;

  const meetingType = await prisma.meetingType.findFirst({
    where: { scope: "PROJECT", projectId: project.id, slug: meetingTypeSlug, isActive: true },
  });
  if (!meetingType) return null;

  const assignedHostId = meetingType.assignedHostIds[0];
  if (!assignedHostId) return null;
  const assignedHost = await prisma.host.findUnique({
    where: { id: assignedHostId },
    include: { calendars: true },
  });
  if (!assignedHost) return null;

  return {
    host: assignedHost,
    meetingType,
    projectName: project.name,
    publicSlug: project.slug,
  };
}
