import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableSlotsForMeetingType } from "@/lib/availability";
import { isGoogleAuthError } from "@/lib/google/client";
import { resolvePublicBooking } from "@/lib/booking-public";
import { ReschedulePicker } from "./picker";

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ slug: string; meetingTypeSlug: string; bookingId: string }>;
}) {
  const { slug, meetingTypeSlug, bookingId } = await params;
  const booking = await resolvePublicBooking(slug, meetingTypeSlug, bookingId);
  if (!booking) notFound();

  if (booking.status === "CANCELLED") {
    redirect(`/${slug}/${meetingTypeSlug}/confirmed/${booking.id}`);
  }

  // Reuse the public booking page's availability flow against the booked host. We pull the
  // assigned host's profile + calendars so the engine sees the right working hours.
  const host = await prisma.host.findUnique({
    where: { id: booking.hostId },
    include: { calendars: true },
  });
  if (!host) notFound();

  const now = new Date();
  const range = {
    from: now,
    to: new Date(now.getTime() + booking.meetingType.maxAdvanceDays * 24 * 3600 * 1000),
  };

  let slots: { startsAt: string; endsAt: string }[] = [];
  let needsHostReauth = false;
  try {
    const computed = await getAvailableSlotsForMeetingType(booking.meetingType, host, range);
    slots = computed
      // Drop the booking's own slot from the busy list — fetchHostBusy returns it as conflicting,
      // but for reschedule we want it surfaced (technically it gets filtered out as busy, so the
      // engine produces alternatives only). Nothing to add here; we just rely on engine output.
      .map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
  } catch (err) {
    if (isGoogleAuthError(err)) needsHostReauth = true;
    else throw err;
  }

  if (needsHostReauth) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Reschedule unavailable</h1>
          <p className="text-sm text-muted-foreground">
            {host.name} needs to reconnect their calendar. Please try again later or cancel and
            book a fresh slot.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-12 md:px-6 md:py-16">
        <div className="rounded-xl border border-border bg-surface shadow-xs p-8 md:p-10">
          <ReschedulePicker
            bookingId={booking.id}
            hostName={host.name}
            meetingTypeName={booking.meetingType.name}
            durationMinutes={booking.meetingType.durationMinutes}
            currentStartsAt={booking.startsAt.toISOString()}
            currentEndsAt={booking.endsAt.toISOString()}
            slots={slots}
            backUrl={`/${slug}/${meetingTypeSlug}/confirmed/${booking.id}`}
          />
        </div>
      </div>
    </main>
  );
}
