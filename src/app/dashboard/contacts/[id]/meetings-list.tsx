"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, Clock, ExternalLink, Mail, MapPin, Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogBody } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";

// Per-contact booking history with click-to-open popup. Each row opens a Dialog with the full
// booking details + a deep-link to the public confirmation page if the host wants to do more.
// Three sections: upcoming / past / cancelled, each independently empty-stated.

export interface MeetingItem {
  id: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED" | "PENDING_APPROVAL";
  inviteeName: string;
  inviteeEmail: string;
  meetUrl: string | null;
  conferencingProvider:
    | "GOOGLE_MEET"
    | "ZOOM"
    | "TEAMS"
    | "IN_PERSON"
    | "PERSONAL_ROOM"
    | "NONE";
  alternativeLocation: string | null;
  meetingTypeName: string;
  meetingTypeSlug: string;
  defaultLocation: string | null;
  hostName: string;
  hostSlug: string;
  projectSlug: string | null;
}

export function ContactMeetingsList({
  upcoming,
  past,
  cancelled,
}: {
  upcoming: MeetingItem[];
  past: MeetingItem[];
  cancelled: MeetingItem[];
}) {
  const [active, setActive] = useState<MeetingItem | null>(null);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <MeetingsCard title="Upcoming" items={upcoming} onPick={setActive} />
        <MeetingsCard title="Past" items={past} onPick={setActive} />
        <MeetingsCard title="Cancelled" items={cancelled} onPick={setActive} />
      </div>

      <MeetingDialog
        meeting={active}
        onClose={() => setActive(null)}
      />
    </>
  );
}

function MeetingsCard({
  title,
  items,
  onPick,
}: {
  title: string;
  items: MeetingItem[];
  onPick: (m: MeetingItem) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title}
          {items.length > 0 && (
            <span className="ml-1 text-muted-foreground font-normal">({items.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No {title.toLowerCase()} meetings.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onPick(b)}
                  className="w-full text-left px-6 py-3 hover:bg-surface-muted transition-colors"
                >
                  <p className="text-sm font-medium text-foreground truncate">
                    {b.meetingTypeName}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(b.startsAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MeetingDialog({
  meeting,
  onClose,
}: {
  meeting: MeetingItem | null;
  onClose: () => void;
}) {
  if (!meeting) {
    return (
      <Dialog open={false} onOpenChange={onClose}>
        <span />
      </Dialog>
    );
  }
  const slug = meeting.projectSlug ?? meeting.hostSlug;
  const detailHref = `/${slug}/${meeting.meetingTypeSlug}/confirmed/${meeting.id}`;
  const inPerson = meeting.conferencingProvider === "IN_PERSON";
  const location = meeting.alternativeLocation ?? (inPerson ? meeting.defaultLocation : null);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader
        title={meeting.meetingTypeName}
        description={`with ${meeting.hostName}`}
        onClose={onClose}
      />
      <DialogBody className="space-y-3">
        <StatusPill status={meeting.status} />
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="text-foreground">{formatRange(meeting.startsAt, meeting.endsAt)}</span>
          </li>
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{durationMinutes(meeting.startsAt, meeting.endsAt)} minutes</span>
          </li>
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <span>
              {meeting.inviteeName} &lt;{meeting.inviteeEmail}&gt;
            </span>
          </li>
          {location && (
            <li className="flex items-start gap-2">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{location}</span>
            </li>
          )}
          {meeting.meetUrl && meeting.status !== "CANCELLED" && (
            <li className="flex items-center gap-2">
              <Video className="h-4 w-4 shrink-0" />
              <a
                href={meeting.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline truncate"
              >
                {providerLabel(meeting.conferencingProvider)} — join
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

function StatusPill({ status }: { status: MeetingItem["status"] }) {
  const map: Record<MeetingItem["status"], { label: string; cls: string }> = {
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

function providerLabel(p: MeetingItem["conferencingProvider"]): string {
  switch (p) {
    case "ZOOM": return "Zoom";
    case "TEAMS": return "Microsoft Teams";
    case "IN_PERSON": return "In person";
    case "PERSONAL_ROOM": return "Personal room";
    case "NONE": return "No conferencing";
    default: return "Google Meet";
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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
