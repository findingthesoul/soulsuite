"use client";

import Link from "next/link";
import { Calendar, Clock, ExternalLink, Mail, MapPin, Video } from "lucide-react";
import { Dialog, DialogHeader, DialogBody } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";

// Shared booking-detail popup. Used by:
//   - /dashboard/bookings (click a row → open here instead of navigating)
//   - /dashboard/contacts/[id] (per-contact meeting list)
//   - /dashboard/book (after a host-initiated booking submits, show what just happened)
//
// All data is passed in as plain props — no fetching inside. Callers shape their query / state
// to match BookingDetail and the dialog renders status pill, time, attendee, location, join
// link, plus a link out to the public confirmation page (cancel/reschedule live there).

export type BookingStatus =
  | "CONFIRMED"
  | "CANCELLED"
  | "RESCHEDULED"
  | "PENDING_APPROVAL";

export type ConferencingProvider =
  | "GOOGLE_MEET"
  | "ZOOM"
  | "TEAMS"
  | "IN_PERSON"
  | "PERSONAL_ROOM"
  | "PERSONAL_ZOOM_ROOM"
  | "PERSONAL_TEAMS_ROOM"
  | "NONE";

export interface BookingDetail {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  status: BookingStatus;
  inviteeName: string;
  inviteeEmail: string;
  meetUrl: string | null;
  conferencingProvider: ConferencingProvider;
  alternativeLocation: string | null;
  meetingTypeName: string;
  meetingTypeSlug: string;
  defaultLocation: string | null;
  hostName: string;
  hostSlug: string;
  projectSlug: string | null;
  // Optional context line — e.g. "Awaiting payment", "Calendar invite sent". Renders just
  // under the status pill when provided.
  note?: string | null;
}

export function BookingDetailDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!booking) {
    return (
      <Dialog open={false} onOpenChange={(v) => !v && onClose()}>
        <span />
      </Dialog>
    );
  }
  const slug = booking.projectSlug ?? booking.hostSlug;
  const detailHref = `/${slug}/${booking.meetingTypeSlug}/confirmed/${booking.id}`;
  const inPerson = booking.conferencingProvider === "IN_PERSON";
  const location = booking.alternativeLocation ?? (inPerson ? booking.defaultLocation : null);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader
        title={booking.meetingTypeName}
        description={`with ${booking.hostName}`}
        onClose={onClose}
      />
      <DialogBody className="space-y-3">
        <StatusPill status={booking.status} />
        {booking.note && (
          <p className="text-xs text-muted-foreground">{booking.note}</p>
        )}
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="text-foreground">
              {formatRange(booking.startsAt, booking.endsAt)}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{durationMinutes(booking.startsAt, booking.endsAt)} minutes</span>
          </li>
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <span>
              {booking.inviteeName} &lt;{booking.inviteeEmail}&gt;
            </span>
          </li>
          {location && (
            <li className="flex items-start gap-2">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{location}</span>
            </li>
          )}
          {booking.meetUrl && booking.status !== "CANCELLED" && (
            <li className="flex items-center gap-2">
              <Video className="h-4 w-4 shrink-0" />
              <a
                href={booking.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline truncate"
              >
                {providerLabel(booking.conferencingProvider)} — join
              </a>
            </li>
          )}
        </ul>
        <div className="pt-2 flex justify-end">
          <Link
            href={detailHref}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open booking page
          </Link>
        </div>
      </DialogBody>
    </Dialog>
  );
}

function StatusPill({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, { label: string; cls: string }> = {
    CONFIRMED: { label: "Confirmed", cls: "bg-foreground text-background" },
    RESCHEDULED: { label: "Rescheduled", cls: "bg-surface-muted text-foreground" },
    CANCELLED: { label: "Cancelled", cls: "bg-destructive/10 text-destructive" },
    PENDING_APPROVAL: {
      label: "Awaiting approval",
      cls: "bg-accent text-accent-foreground",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function providerLabel(p: ConferencingProvider): string {
  switch (p) {
    case "ZOOM": return "Zoom";
    case "TEAMS": return "Microsoft Teams";
    case "IN_PERSON": return "In person";
    case "PERSONAL_ROOM": return "Personal room";
    case "PERSONAL_ZOOM_ROOM": return "Personal Zoom room";
    case "PERSONAL_TEAMS_ROOM": return "Personal Teams room";
    case "NONE": return "No conferencing";
    default: return "Google Meet";
  }
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}

function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}
