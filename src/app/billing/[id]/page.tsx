import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CenterShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BillingForm } from "./form";

// Public landing for a host-initiated INVOICE booking. The invitee opens this with a token in
// the query string; we resolve the booking, render a "this is your meeting" recap + the
// invoice details form. Submission flips paymentStatus to INVOICE_PENDING and triggers the
// standard finalize path (Google event + confirmation email).

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const token = sp.token ?? "";

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      meetingType: {
        select: { name: true, priceCents: true, priceCurrency: true },
      },
      host: { select: { name: true, email: true } },
    },
  });
  if (!booking) notFound();

  const tokenValid =
    Boolean(booking.invoiceDetailsToken) &&
    booking.invoiceDetailsToken === token &&
    booking.paymentMethod === "INVOICE" &&
    booking.status !== "CANCELLED";

  // Bookings whose token was already consumed (= confirmed) show a friendly "you're already
  // set" landing rather than a hard 404 / 403 — handy when the invitee re-opens the email.
  const alreadyConfirmed =
    !booking.invoiceDetailsToken &&
    booking.paymentMethod === "INVOICE" &&
    booking.paymentStatus !== "PENDING";

  return (
    <CenterShell>
      <div className="w-full max-w-xl space-y-4">
        {!tokenValid && !alreadyConfirmed && (
          <Card>
            <CardHeader>
              <CardTitle>Link no longer valid</CardTitle>
              <CardDescription>
                This billing link has expired or already been used. If you need to update your
                details, reply to the email from {booking.host.name} directly.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {alreadyConfirmed && (
          <Card>
            <CardHeader>
              <CardTitle>You&apos;re already booked</CardTitle>
              <CardDescription>
                We&apos;ve recorded your billing details for the meeting with{" "}
                {booking.host.name}. An invoice will follow separately.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {tokenValid && (
          <BillingForm
            bookingId={booking.id}
            token={token}
            inviteeName={booking.inviteeName}
            inviteeEmail={booking.inviteeEmail}
            hostName={booking.host.name}
            meetingTypeName={booking.meetingType.name}
            startsAtIso={booking.startsAt.toISOString()}
            endsAtIso={booking.endsAt.toISOString()}
            priceCents={booking.meetingType.priceCents ?? 0}
            priceCurrency={booking.meetingType.priceCurrency ?? "eur"}
            // When googleEventId is already set, the reservation went through in default mode
            // — billing form copy should reflect "for the invoice", not "to confirm".
            reservationAlreadyConfirmed={Boolean(booking.googleEventId)}
          />
        )}
      </div>
    </CenterShell>
  );
}
