import { notFound } from "next/navigation";
import { Calendar, Clock, Mail, Video } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmedDateTime } from "./client";

// Public confirmation page — shown after a successful booking. Anyone with the booking ID
// can see the basic confirmation; we don't expose intake answers or the Meet link to anonymous
// visitors. The confirmation email (step 12 of the build order) will carry the full details.
export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ hostSlug: string; meetingTypeSlug: string; bookingId: string }>;
}) {
  const { hostSlug, meetingTypeSlug, bookingId } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { host: true, meetingType: true },
  });
  if (!booking) notFound();
  if (booking.host.slug !== hostSlug || booking.meetingType.slug !== meetingTypeSlug) notFound();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-12 md:px-6 md:py-20">
        <div className="rounded-xl border border-border bg-surface shadow-xs p-8 md:p-10 space-y-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background font-medium">
              ✓
            </span>
            <h1 className="text-xl font-semibold tracking-tight">You&apos;re booked</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            A confirmation has been sent to{" "}
            <span className="text-foreground font-medium">{booking.inviteeEmail}</span>.
          </p>

          <div className="rounded-lg border border-border p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={booking.host.name} size="sm" />
              <div>
                <p className="text-sm font-medium text-foreground">{booking.host.name}</p>
                <p className="text-xs text-muted-foreground">{booking.meetingType.name}</p>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <ConfirmedDateTime startsAt={booking.startsAt.toISOString()} endsAt={booking.endsAt.toISOString()} />
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{booking.meetingType.durationMinutes} minutes</span>
              </li>
              <li className="flex items-center gap-2">
                <Video className="h-4 w-4" />
                <span>Google Meet — link in your calendar invite</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <span>{booking.inviteeEmail}</span>
              </li>
            </ul>
          </div>

          <p className="text-xs text-subtle-foreground">
            Need to cancel or reschedule? Use the link in your confirmation email.
            {/* Cancel/reschedule pages come in build-order step 12. */}
          </p>
        </div>
      </div>
    </main>
  );
}
