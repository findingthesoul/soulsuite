import { notFound } from "next/navigation";
import Link from "next/link";
import { Calendar, CalendarPlus, Clock, Mail, MapPin, Video, X, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { resolvePublicBooking } from "@/lib/booking-public";
import { ConfirmedDateTime } from "./client";

// Public confirmation + self-service page. Anyone with the booking ID can cancel or reschedule —
// the ID is a CUID (~22 random chars), unguessable in practice. Email-based magic links land
// later (build-order step 12).
export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ slug: string; meetingTypeSlug: string; bookingId: string }>;
}) {
  const { slug, meetingTypeSlug, bookingId } = await params;

  const booking = await resolvePublicBooking(slug, meetingTypeSlug, bookingId);
  if (!booking) notFound();

  const isCancelled = booking.status === "CANCELLED";
  const baseUrl = `/${slug}/${meetingTypeSlug}/confirmed/${booking.id}`;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-12 md:px-6 md:py-20">
        <div className="rounded-xl border border-border bg-surface shadow-xs p-8 md:p-10 space-y-6">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full font-medium ${
                isCancelled
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-foreground text-background"
              }`}
            >
              {isCancelled ? "✕" : "✓"}
            </span>
            <h1 className="text-xl font-semibold tracking-tight">
              {isCancelled ? "Booking cancelled" : "You're booked"}
            </h1>
          </div>

          {!isCancelled && (
            <p className="text-sm text-muted-foreground">
              Sent to <span className="text-foreground font-medium">{booking.inviteeEmail}</span>.
            </p>
          )}

          <div className={`rounded-lg border border-border p-5 space-y-3 ${isCancelled ? "opacity-60" : ""}`}>
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
                <ConfirmedDateTime
                  startsAt={booking.startsAt.toISOString()}
                  endsAt={booking.endsAt.toISOString()}
                />
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{booking.meetingType.durationMinutes} minutes</span>
              </li>
              {!isCancelled && booking.alternativeLocation && (
                <li className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5" />
                  <span>
                    <span className="block text-foreground font-medium">Location</span>
                    <span className="block text-xs whitespace-pre-line">
                      {booking.alternativeLocation}
                    </span>
                  </span>
                </li>
              )}
              {!isCancelled &&
                !booking.alternativeLocation &&
                booking.conferencingProvider === "IN_PERSON" && (
                  <li className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5" />
                    <span>
                      <span className="block text-foreground font-medium">In person</span>
                      {booking.meetingType.defaultLocation && (
                        <span className="block text-xs whitespace-pre-line">
                          {booking.meetingType.defaultLocation}
                        </span>
                      )}
                    </span>
                  </li>
                )}
              {!isCancelled &&
                booking.conferencingProvider !== "NONE" &&
                booking.conferencingProvider !== "IN_PERSON" && (
                  <li className="flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    {booking.meetUrl ? (
                      <a
                        href={booking.meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-foreground"
                      >
                        {providerLabel(booking.conferencingProvider)} — join link
                      </a>
                    ) : (
                      <span>
                        {providerLabel(booking.conferencingProvider)} — link in your calendar invite
                      </span>
                    )}
                  </li>
                )}
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <span>{booking.inviteeEmail}</span>
              </li>
            </ul>
          </div>

          {!isCancelled && (
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={`${baseUrl}/calendar.ics`} className={buttonVariants({ variant: "secondary" })}>
                <CalendarPlus className="h-3.5 w-3.5" />
                Add to calendar
              </a>
              <Link href={`${baseUrl}/reschedule`} className={buttonVariants({ variant: "secondary" })}>
                <RefreshCw className="h-3.5 w-3.5" />
                Reschedule
              </Link>
              <Link href={`${baseUrl}/cancel`} className={buttonVariants({ variant: "secondary" })}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function providerLabel(p: "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "IN_PERSON" | "NONE"): string {
  switch (p) {
    case "ZOOM": return "Zoom";
    case "TEAMS": return "Microsoft Teams";
    case "IN_PERSON": return "In person";
    case "NONE": return "No conferencing";
    default: return "Google Meet";
  }
}
