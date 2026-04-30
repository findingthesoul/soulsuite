import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { resolvePublicBooking } from "@/lib/booking-public";
import { ConfirmedDateTime } from "../client";
import { CancelButton } from "./button";

export default async function CancelPage({
  params,
}: {
  params: Promise<{ slug: string; meetingTypeSlug: string; bookingId: string }>;
}) {
  const { slug, meetingTypeSlug, bookingId } = await params;
  const booking = await resolvePublicBooking(slug, meetingTypeSlug, bookingId);
  if (!booking) notFound();

  // Already cancelled — bounce to the confirmation page which shows the cancelled state.
  if (booking.status === "CANCELLED") {
    redirect(`/${slug}/${meetingTypeSlug}/confirmed/${booking.id}`);
  }

  const baseUrl = `/${slug}/${meetingTypeSlug}/confirmed/${booking.id}`;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-12 md:px-6 md:py-20">
        <div className="rounded-xl border border-border bg-surface shadow-xs p-8 md:p-10 space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Cancel this booking?</h1>
            <p className="text-sm text-muted-foreground">
              The calendar event will be removed and {booking.host.name} will be notified.
            </p>
          </div>

          <div className="rounded-lg border border-border p-5 space-y-2">
            <div className="flex items-center gap-3">
              <Avatar name={booking.host.name} size="sm" />
              <div>
                <p className="text-sm font-medium text-foreground">{booking.host.name}</p>
                <p className="text-xs text-muted-foreground">{booking.meetingType.name}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              <ConfirmedDateTime
                startsAt={booking.startsAt.toISOString()}
                endsAt={booking.endsAt.toISOString()}
              />
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Link href={baseUrl} className={buttonVariants({ variant: "secondary" })}>
              Keep booking
            </Link>
            <CancelButton bookingId={booking.id} returnUrl={baseUrl} />
          </div>
        </div>
      </div>
    </main>
  );
}
