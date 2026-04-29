import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";
import { isGoogleAuthError } from "@/lib/google/client";
import { BookingFlow } from "./flow";
import { RESERVED_SLUGS } from "@/lib/slugs.constants";

// Public booking page — no auth. Resolves /{hostSlug}/{meetingTypeSlug} → meeting type +
// pre-fetched slots for the next N days. Hands off to a client component for slot selection +
// invitee details.
//
// We pre-fetch on the server so first paint shows real availability. The client can re-fetch
// as the user navigates dates.
export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ hostSlug: string; meetingTypeSlug: string }>;
}) {
  const { hostSlug, meetingTypeSlug } = await params;

  // Reserved-slug guard: top-level paths like /dashboard, /api, etc. should never reach here
  // (Next routes them first), but defend in case.
  if ((RESERVED_SLUGS as readonly string[]).includes(hostSlug)) notFound();

  const host = await prisma.host.findUnique({
    where: { slug: hostSlug },
    include: { calendars: true },
  });
  if (!host) notFound();

  const meetingType = await prisma.meetingType.findFirst({
    where: { scope: "PERSONAL", hostId: host.id, slug: meetingTypeSlug, isActive: true },
  });
  if (!meetingType) notFound();

  // Initial range: from now (rounded up to the next slot grid increment) through the next
  // maxAdvanceDays. The client's date picker will re-query for narrower windows.
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
    if (isGoogleAuthError(err)) {
      needsHostReauth = true;
    } else {
      throw err;
    }
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
      host={{ slug: host.slug, name: host.name, timezone: host.timezone }}
      meetingType={{
        id: meetingType.id,
        slug: meetingType.slug,
        name: meetingType.name,
        description: meetingType.description,
        durationMinutes: meetingType.durationMinutes,
      }}
      initialSlots={slots}
    />
  );
}
