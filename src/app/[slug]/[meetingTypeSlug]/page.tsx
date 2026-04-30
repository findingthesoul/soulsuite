import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";
import { isGoogleAuthError } from "@/lib/google/client";
import { BookingFlow } from "./flow";
import { RESERVED_SLUGS } from "@/lib/slugs.constants";
import type { IntakeField } from "@/lib/intake";
import { computeRoundRobinSlots } from "@/lib/round-robin";
import { computeCollectiveSlots } from "@/lib/availability/collective";

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

  const { host, meetingType, projectName, publicSlug, intakeFields } = resolved;

  const now = new Date();
  const range = {
    from: now,
    to: new Date(now.getTime() + meetingType.maxAdvanceDays * 24 * 3600 * 1000),
  };

  let slots: { startsAt: string; endsAt: string }[] = [];
  let needsHostReauth = false;
  try {
    if (meetingType.routingMode === "ROUND_ROBIN" && resolved.multiHosts) {
      const computed = await computeRoundRobinSlots(meetingType, resolved.multiHosts, range);
      slots = computed.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      }));
    } else if (meetingType.routingMode === "COLLECTIVE" && resolved.multiHosts) {
      const computed = await computeCollectiveSlots(meetingType, resolved.multiHosts, range);
      slots = computed.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      }));
    } else {
      const computed = await getAvailableSlotsForMeetingType(meetingType, host, range);
      slots = computed.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
    }
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
        conferencingProvider: meetingType.conferencingProvider,
      }}
      projectName={projectName}
      intakeFields={intakeFields}
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
      include: { intakeForm: true },
    });
    if (!meetingType) return null;
    const intakeFields = (meetingType.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];
    return {
      host,
      meetingType,
      projectName: null as string | null,
      publicSlug: host.slug,
      intakeFields,
      multiHosts: null as (typeof host & { calendars: typeof host.calendars })[] | null,
    };
  }

  // Path B: project meeting type under a project slug. SINGLE → resolve the one assigned host.
  // ROUND_ROBIN → load all assigned hosts and let the round-robin engine union their availability.
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project || !project.isActive) return null;

  const meetingType = await prisma.meetingType.findFirst({
    where: { scope: "PROJECT", projectId: project.id, slug: meetingTypeSlug, isActive: true },
    include: { intakeForm: true },
  });
  if (!meetingType) return null;
  if (meetingType.assignedHostIds.length === 0) return null;

  const assignedHosts = await prisma.host.findMany({
    where: { id: { in: meetingType.assignedHostIds } },
    include: { calendars: true },
  });
  if (assignedHosts.length === 0) return null;

  // The "primary" host for the public-facing avatar/name on the booking page. For ROUND_ROBIN
  // we just show the first assigned host's name; the actual booked host is decided at submit
  // time. Round-robin avatars / "any of N hosts" UX is a future polish item.
  const primaryHost = assignedHosts[0];
  const intakeFields = (meetingType.intakeForm?.fields as unknown as IntakeField[] | undefined) ?? [];

  return {
    host: primaryHost,
    meetingType,
    projectName: project.name,
    publicSlug: project.slug,
    intakeFields,
    multiHosts:
      meetingType.routingMode === "ROUND_ROBIN" || meetingType.routingMode === "COLLECTIVE"
        ? assignedHosts
        : null,
  };
}
