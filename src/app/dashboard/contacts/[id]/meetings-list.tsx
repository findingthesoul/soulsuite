"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BookingDetailDialog,
  type BookingDetail,
} from "@/components/booking-detail-dialog";

// Per-contact booking history with click-to-open popup. Three sections: upcoming / past /
// cancelled, each independently empty-stated. The popup itself lives in
// `BookingDetailDialog` so /dashboard/bookings + /dashboard/book can share the same
// presentation.

export type MeetingItem = BookingDetail;

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

      <BookingDetailDialog
        booking={active}
        open={Boolean(active)}
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
