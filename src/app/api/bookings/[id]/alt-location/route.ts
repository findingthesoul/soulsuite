// PATCH /api/bookings/[id]/alt-location — host-editable per-booking location override.
//
// Caller authorisation reuses the admin-access helper from retry/refund: only the booking's
// own host (or a workspace owner/admin sharing a workspace with the host) can edit. Invitees
// have no path to set this.
//
// Side effects on a successful update:
//   1. Patch the Google Calendar event's `location` field to the new value (or the previously
//      derived value when reverting to null).
//   2. Append a "Location updated" line to the event description so attendees see the change.
//   3. Send a brief notification email to the invitee (replies route to the host).
//
// Reverting to empty/null: we replace the event location with whatever the conferencing
// provider would have produced — the existing meetUrl for online meetings, or the MT's
// defaultLocation for IN_PERSON. The notification email still fires so invitees see the
// "we changed it back" announcement.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { authorizeAdminBookingAction } from "@/lib/bookings/admin-access";
import { sendEmailAfterResponse, bookingLocationUpdateTemplate } from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { resolveRecipientTimezone } from "@/lib/recipient-timezone";
import { workspaceIdForMeetingType } from "@/lib/contacts";

const bodySchema = z.object({
  // Empty string + null both mean "revert to provider-generated". We trim and treat empty as null.
  alternativeLocation: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caller = await getCurrentHost();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const auth = await authorizeAdminBookingAction(caller, id);
  if (!auth.ok) {
    return new NextResponse(auth.message, { status: auth.status });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new NextResponse(parsed.error.issues[0]?.message ?? "invalid body", { status: 400 });
  }
  const incoming = parsed.data.alternativeLocation;
  const cleaned = typeof incoming === "string" ? incoming.trim() : null;
  const newValue = cleaned && cleaned.length > 0 ? cleaned : null;

  // Load the full booking + host calendar so we can patch the Google event.
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { host: true, meetingType: true },
  });
  if (!booking) return new NextResponse("Booking not found", { status: 404 });
  if (booking.status === "CANCELLED") {
    return new NextResponse("Booking is cancelled", { status: 409 });
  }

  // Compute what the calendar event's `location` should now show. Mirrors finalize.ts.
  const fallback =
    booking.conferencingProvider === "IN_PERSON"
      ? booking.meetingType.defaultLocation ?? ""
      : booking.meetUrl ?? "";
  const targetEventLocation = newValue ?? fallback;

  // Patch the Google event in place (no recreate — preserves attendee RSVPs + the existing Meet
  // conference link). Best-effort: a Google failure still updates the DB so the host can re-try.
  let googleStatus: "ok" | "skipped" | "auth-broken" | "failed" = "skipped";
  if (booking.googleEventId && booking.host.googleRefreshToken) {
    try {
      const writeTarget = await prisma.calendar.findFirst({
        where: { hostId: booking.hostId, role: "WRITE_TARGET" },
      });
      if (writeTarget) {
        const cal = calendarFor(booking.host.googleRefreshToken);
        // Append (rather than replace) the description so the original booking notes are kept.
        const existingEv = await cal.events.get({
          calendarId: writeTarget.googleCalendarId,
          eventId: booking.googleEventId,
        });
        const baseDescription = (existingEv.data.description ?? "").replace(
          /\n*Location updated:[^\n]*$/u,
          "",
        );
        const nextDescription =
          newValue !== null
            ? `${baseDescription}\n\nLocation updated: ${newValue}`.trimStart()
            : baseDescription;
        await cal.events.patch({
          calendarId: writeTarget.googleCalendarId,
          eventId: booking.googleEventId,
          sendUpdates: "none",
          requestBody: {
            location: targetEventLocation || undefined,
            description: nextDescription,
          },
        });
        googleStatus = "ok";
      }
    } catch (err) {
      if (isGoogleAuthError(err)) {
        await prisma.host
          .update({ where: { id: booking.hostId }, data: { googleRefreshToken: null } })
          .catch(() => undefined);
        googleStatus = "auth-broken";
      } else {
        console.error("[alt-location] google patch failed", err);
        googleStatus = "failed";
      }
    }
  }

  await prisma.booking.update({
    where: { id },
    data: { alternativeLocation: newValue },
  });

  // Notification email — fire-and-forget. Reverting to empty still notifies; that's the spec.
  // For a freshly PENDING (paid, not yet finalised) booking there's no invitee-facing event yet,
  // but the booking row has the invitee's email so we can still alert them.
  try {
    const wsIdLoc = await workspaceIdForMeetingType(booking.meetingTypeId);
    const inviteeTz = await resolveRecipientTimezone({
      email: booking.inviteeEmail,
      workspaceId: wsIdLoc,
      fallback: booking.host.timezone,
    });
    const tmpl = bookingLocationUpdateTemplate({
      hostName: booking.host.name,
      meetingTypeName: booking.meetingType.name,
      startsAtIso: booking.startsAt.toISOString(),
      endsAtIso: booking.endsAt.toISOString(),
      inviteeName: booking.inviteeName,
      newLocation: newValue ?? fallback ?? "(see calendar invite)",
      meetUrl: booking.meetUrl,
      logoUrl: await getEmailLogoUrl(),
      timezone: inviteeTz,
    });
    sendEmailAfterResponse({
      to: booking.inviteeEmail,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
      fromName: booking.host.name,
      replyTo: booking.host.email,
    });
  } catch (err) {
    console.error("[alt-location] email queue failed", err);
  }

  return NextResponse.json({ ok: true, googleStatus });
}
