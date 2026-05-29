// Booking finalisation — the side-effecty bit that runs *after* the Booking row exists and
// (for paid MTs) Stripe has confirmed payment. Extracted from /api/bookings/route.ts so the
// Stripe webhook can call exactly the same path on `checkout.session.completed`.
//
// What this does (in order):
//   1. Create the Zoom meeting (when conferencingProvider === ZOOM).
//   2. Create the Google Calendar event on the host's write-target calendar.
//   3. Update the Booking row with googleEventId / meetUrl / providerMeetingId.
//   4. Stamp ProjectMember.lastAssignedAt for round-robin fairness.
//   5. Send the confirmation email.
//   6. Bust the per-host freebusy cache.
//   7. Upsert the Contact row.
//
// On any failure of step 1 or 2 the Booking row is deleted (caller convention from the original
// inline flow). Returns `{ ok: true }` on success or `{ ok: false, status, message }` so both
// the bookings API (which renders an HTTP response) and the webhook (which logs) can react.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { calendarFor, isGoogleAuthError } from "@/lib/google/client";
import { bustFreebusyCacheForHost } from "@/lib/availability/freebusy";
import {
  sendEmailAfterResponse,
  bookingConfirmationTemplate,
  newBookingForHostTemplate,
  appUrl,
} from "@/lib/email";
import { getEmailLogoUrl } from "@/lib/branding";
import { getZoomAccessTokenForHost } from "@/lib/zoom/host";
import { createZoomMeeting, ZoomAlternativeHostsError } from "@/lib/zoom/client";
import { upsertContactFromBooking, workspaceIdForMeetingType } from "@/lib/contacts";
import { resolveRecipientTimezone } from "@/lib/recipient-timezone";
import type { InvoiceDetails } from "@/lib/bookings/invoice-details";

export type FinalizeResult =
  | { ok: true; meetUrl: string | null; googleEventId: string | null }
  | { ok: false; status: number; message: string };

interface FinalizeArgs {
  bookingId: string;
  // Caller passes the resolved host + co-hosts so we don't re-run round-robin / availability.
  // For SINGLE / ROUND_ROBIN: host = the picked booker, collectiveCoHosts = []. For COLLECTIVE:
  // host = the conferencing host, collectiveCoHosts = the other assigned hosts.
  hostId: string;
  collectiveCoHostIds: string[];
  inviteeTimezone: string;
}

export async function finalizeBooking(args: FinalizeArgs): Promise<FinalizeResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      meetingType: true,
    },
  });
  if (!booking) return { ok: false, status: 404, message: "Booking not found" };

  // Idempotent: if we've already finalised this booking (e.g. duplicate webhook delivery), bail.
  if (booking.googleEventId) {
    return { ok: true, meetUrl: booking.meetUrl, googleEventId: booking.googleEventId };
  }

  const meetingType = booking.meetingType;
  const [host, coHosts] = await Promise.all([
    prisma.host.findUnique({
      where: { id: args.hostId },
      include: { calendars: true },
    }),
    args.collectiveCoHostIds.length > 0
      ? prisma.host.findMany({
          where: { id: { in: args.collectiveCoHostIds } },
          select: { id: true, email: true, name: true, timezone: true },
        })
      : Promise.resolve([] as { id: string; email: string; name: string; timezone: string }[]),
  ]);
  if (!host) return { ok: false, status: 404, message: "Host not found" };
  if (!host.googleRefreshToken) {
    return { ok: false, status: 503, message: "Host has no Google credentials" };
  }
  const writeTarget = host.calendars.find((c) => c.role === "WRITE_TARGET");
  if (!writeTarget) {
    return { ok: false, status: 404, message: "Host has no write-target calendar" };
  }

  const startsAt = booking.startsAt;
  const endsAt = booking.endsAt;

  // ── In-person: skip Zoom + Meet conference creation; the calendar event's `location` is
  // set to the meeting type's defaultLocation. The Booking row gets meetUrl=null.
  const isInPerson = meetingType.conferencingProvider === "IN_PERSON";
  // ── Personal room: skip every provider call; the host's stored personal-room URL is the
  // meet URL. Two flavours live side-by-side (Zoom vs Teams) so a host can keep both rooms
  // and pick per MT. For COLLECTIVE, args.hostId is the conferencing host (caller convention),
  // so we always read off the right host's URL. If the relevant URL is null at finalize time
  // the host cleared it after the MT was saved — fail finalize the same way Zoom-no-token
  // does (paid → CANCELLED, free → delete).
  const isPersonalRoom =
    meetingType.conferencingProvider === "PERSONAL_ZOOM_ROOM" ||
    meetingType.conferencingProvider === "PERSONAL_TEAMS_ROOM" ||
    meetingType.conferencingProvider === "PERSONAL_ROOM"; // legacy rows pre-migration
  let personalRoomUrl: string | null = null;
  if (isPersonalRoom) {
    const url =
      meetingType.conferencingProvider === "PERSONAL_TEAMS_ROOM"
        ? host.personalTeamsRoomUrl
        : host.personalZoomRoomUrl; // covers PERSONAL_ZOOM_ROOM + legacy PERSONAL_ROOM (data was migrated into the zoom slot)
    if (!url) {
      if (booking.paymentStatus === "PAID") {
        await prisma.booking
          .update({ where: { id: booking.id }, data: { status: "CANCELLED" } })
          .catch(() => undefined);
      } else {
        await prisma.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
      }
      const platform =
        meetingType.conferencingProvider === "PERSONAL_TEAMS_ROOM" ? "Teams" : "Zoom";
      return {
        ok: false,
        status: 502,
        message: `The host hasn't set up their personal ${platform} room URL — please pick another time or contact them.`,
      };
    }
    personalRoomUrl = url;
  }

  // ── Zoom ──
  let zoomMeeting: { meetingId: string; joinUrl: string; passcode: string | null } | null = null;
  if (meetingType.conferencingProvider === "ZOOM") {
    try {
      const accessToken = await getZoomAccessTokenForHost(host.id);
      if (!accessToken) {
        if (booking.paymentStatus === "PAID") {
        // Paid: keep the row so /confirmed renders a useful error and we have an audit trail.
        await prisma.booking
          .update({ where: { id: booking.id }, data: { status: "CANCELLED" } })
          .catch(() => undefined);
      } else {
        await prisma.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
      }
        return {
          ok: false,
          status: 502,
          message: "The host hasn't connected Zoom — please pick another time or contact them.",
        };
      }
      const altHosts =
        meetingType.routingMode === "COLLECTIVE" ? coHosts.map((h) => h.email) : [];
      const zoomArgs = {
        topic: `${meetingType.name} — ${booking.inviteeName}`,
        startsAtIso: startsAt.toISOString(),
        durationMinutes: meetingType.durationMinutes,
        timezone: "UTC",
        agenda: meetingType.description ?? undefined,
      };
      try {
        zoomMeeting = await createZoomMeeting(accessToken, {
          ...zoomArgs,
          alternativeHosts: altHosts,
        });
      } catch (err) {
        if (err instanceof ZoomAlternativeHostsError) {
          console.warn(
            "[booking] zoom alternative_hosts rejected (cross-org); retrying without",
            err.underlying,
          );
          zoomMeeting = await createZoomMeeting(accessToken, zoomArgs);
        } else {
          throw err;
        }
      }
    } catch (err) {
      console.error("[booking] zoom create failed", err);
      if (booking.paymentStatus === "PAID") {
        // Paid: keep the row so /confirmed renders a useful error and we have an audit trail.
        await prisma.booking
          .update({ where: { id: booking.id }, data: { status: "CANCELLED" } })
          .catch(() => undefined);
      } else {
        await prisma.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
      }
      return {
        ok: false,
        status: 502,
        message: "Couldn't create the Zoom meeting — please try again.",
      };
    }
  }

  // ── Google Calendar event ──
  let bookingMeetUrl: string | null = zoomMeeting?.joinUrl ?? personalRoomUrl ?? null;
  let googleEventId: string | null = null;
  try {
    const cal = calendarFor(host.googleRefreshToken);
    const useGoogleMeet = meetingType.conferencingProvider === "GOOGLE_MEET";
    const description =
      `Booked via Soul Suite.\n` +
      `Invitee: ${booking.inviteeName} <${booking.inviteeEmail}>\n` +
      (meetingType.description ? `\n${meetingType.description}\n` : "") +
      (isInPerson && meetingType.defaultLocation
        ? `\nLocation: ${meetingType.defaultLocation}\n`
        : "") +
      (isPersonalRoom && personalRoomUrl ? `\nJoin: ${personalRoomUrl}\n` : "") +
      (zoomMeeting
        ? `\nJoin Zoom: ${zoomMeeting.joinUrl}` +
          (zoomMeeting.passcode ? `\nPasscode: ${zoomMeeting.passcode}` : "") +
          "\n"
        : "");
    // location field: alternativeLocation override wins. Otherwise: in-person → defaultLocation,
    // personal room → the URL, remote → the meet/zoom join URL.
    const eventLocation: string | undefined =
      booking.alternativeLocation ??
      (isInPerson
        ? meetingType.defaultLocation ?? undefined
        : bookingMeetUrl ?? undefined);
    const ev = await cal.events.insert({
      calendarId: writeTarget.googleCalendarId,
      conferenceDataVersion: useGoogleMeet ? 1 : 0,
      // We send our own branded confirmation via Resend (with cancel/reschedule URLs that
       // round-trip to Soul Suite). Setting `none` means Google still adds the event to every
       // attendee's calendar, but doesn't email them about it — invitees get exactly one email.
       sendUpdates: "none",
      requestBody: {
        summary: `${meetingType.name} — ${booking.inviteeName}`,
        description,
        location: eventLocation,
        start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
        end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
        attendees: [
          { email: booking.inviteeEmail, displayName: booking.inviteeName },
          { email: host.email, displayName: host.name, organizer: true },
          ...coHosts.map((h) => ({ email: h.email, displayName: h.name })),
        ],
        conferenceData: useGoogleMeet
          ? {
              createRequest: {
                requestId: randomUUID(),
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            }
          : undefined,
      },
    });
    if (!bookingMeetUrl && useGoogleMeet) bookingMeetUrl = ev.data.hangoutLink ?? null;
    googleEventId = ev.data.id ?? null;
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        googleEventId,
        conferencingProvider: meetingType.conferencingProvider,
        meetUrl: bookingMeetUrl,
        providerMeetingId: zoomMeeting?.meetingId ?? null,
      },
    });
    if (meetingType.scope === "PROJECT" && meetingType.routingMode === "ROUND_ROBIN") {
      await prisma.projectMember.update({
        where: {
          projectId_hostId: { projectId: meetingType.projectId!, hostId: host.id },
        },
        data: { lastAssignedAt: new Date() },
      });
    }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await prisma.host
        .update({ where: { id: host.id }, data: { googleRefreshToken: null } })
        .catch(() => undefined);
    }
    if (booking.paymentStatus === "PAID") {
        // Paid: keep the row so /confirmed renders a useful error and we have an audit trail.
        await prisma.booking
          .update({ where: { id: booking.id }, data: { status: "CANCELLED" } })
          .catch(() => undefined);
      } else {
        await prisma.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
      }
    return {
      ok: false,
      status: 502,
      message: "We couldn't create the calendar event. Please try again or pick a different time.",
    };
  }

  // ── Confirmation email ──
  const publicSlug = meetingType.scope === "PROJECT" ? undefined : host.slug;
  const slugForUrl =
    publicSlug ??
    (
      await prisma.project.findUnique({
        where: { id: meetingType.projectId! },
        select: { slug: true },
      })
    )?.slug ??
    host.slug;
  const logoUrl = await getEmailLogoUrl();
  // Invoice path: surface the captured billing email + company in the confirmation email so
  // the invitee knows who to expect the invoice from. Cast through unknown — the JSON column
  // is validated on write (api/bookings POST) so reads are safe to treat as the schema shape.
  const invoiceDetails =
    booking.paymentMethod === "INVOICE" && booking.invoiceDetails
      ? (booking.invoiceDetails as unknown as InvoiceDetails)
      : null;
  const workspaceIdForTz = await workspaceIdForMeetingType(meetingType.id);
  const inviteeTz = await resolveRecipientTimezone({
    email: booking.inviteeEmail,
    workspaceId: workspaceIdForTz,
    fallback: args.inviteeTimezone || host.timezone,
  });
  const tmpl = bookingConfirmationTemplate({
    hostName: host.name,
    meetingTypeName: meetingType.name,
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    timezone: inviteeTz,
    cancelUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${booking.id}/cancel`),
    rescheduleUrl: appUrl(
      `/${slugForUrl}/${meetingType.slug}/confirmed/${booking.id}/reschedule`,
    ),
    meetUrl: bookingMeetUrl,
    meetUrlLabel: isPersonalRoom
      ? meetingType.conferencingProvider === "PERSONAL_TEAMS_ROOM"
        ? "Personal Teams room"
        : "Personal Zoom room"
      : null,
    // Prefer the per-booking alternativeLocation if a host already set one (e.g. on retry of
    // a previously-failed finalize). Otherwise fall back to the MT's defaultLocation for IN_PERSON.
    location:
      booking.alternativeLocation ??
      (isInPerson ? meetingType.defaultLocation ?? null : null),
    icalUrl: appUrl(`/${slugForUrl}/${meetingType.slug}/confirmed/${booking.id}/calendar.ics`),
    logoUrl,
    invoice: invoiceDetails
      ? {
          billingEmail: invoiceDetails.billingEmail,
          companyName: invoiceDetails.companyName,
          reference: invoiceDetails.reference || null,
        }
      : null,
  });
  sendEmailAfterResponse({
    to: booking.inviteeEmail,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    fromName: host.name,
    replyTo: host.email,
  });

  // Host-side notification. Always email the booking host so they're not relying on Gmail's
  // "an event was added to your calendar" notice. For COLLECTIVE meetings, also email every
  // co-host — they got the silent Google event invite but no Soul Suite signal before this.
  const detailsUrl = appUrl(`/dashboard/bookings/${booking.id}`);
  const locationForHost =
    booking.alternativeLocation ?? (isInPerson ? meetingType.defaultLocation ?? null : null);
  const hostNotification = newBookingForHostTemplate({
    recipientName: host.name,
    isCoHost: false,
    meetingTypeName: meetingType.name,
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    inviteeName: booking.inviteeName,
    inviteeEmail: booking.inviteeEmail,
    meetUrl: bookingMeetUrl,
    location: locationForHost,
    detailsUrl,
    logoUrl,
    timezone: host.timezone,
  });
  sendEmailAfterResponse({
    to: host.email,
    subject: hostNotification.subject,
    html: hostNotification.html,
    text: hostNotification.text,
    replyTo: booking.inviteeEmail,
  });
  // Co-hosts (only set for COLLECTIVE — for SINGLE / ROUND_ROBIN the array is empty).
  for (const co of coHosts) {
    const tpl = newBookingForHostTemplate({
      recipientName: co.name,
      isCoHost: true,
      meetingTypeName: meetingType.name,
      startsAtIso: startsAt.toISOString(),
      endsAtIso: endsAt.toISOString(),
      inviteeName: booking.inviteeName,
      inviteeEmail: booking.inviteeEmail,
      meetUrl: bookingMeetUrl,
      location: locationForHost,
      detailsUrl,
      logoUrl,
      timezone: co.timezone,
    });
    sendEmailAfterResponse({
      to: co.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      replyTo: booking.inviteeEmail,
    });
  }

  bustFreebusyCacheForHost(host.id);

  // Contact upsert — never blocks. Failures logged.
  try {
    const wsId = workspaceIdForTz;
    if (wsId) {
      await upsertContactFromBooking({
        workspaceId: wsId,
        email: booking.inviteeEmail,
        name: booking.inviteeName,
        timeZone: args.inviteeTimezone,
      });
    }
  } catch (err) {
    console.error("[booking] contact upsert failed", err);
  }

  return { ok: true, meetUrl: bookingMeetUrl, googleEventId };
}
