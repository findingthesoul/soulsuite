"use client";

import { useEffect, useState } from "react";

// Renders date + start–end in the visitor's detected timezone. SSR uses UTC + en-GB so the
// first paint matches across server and client; we swap to the local tz post-mount.
export function BookingDateTime({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [label, setLabel] = useState<string>(() => format(startsAt, endsAt, "UTC", "en-GB"));
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLabel(format(startsAt, endsAt, tz));
  }, [startsAt, endsAt]);
  return <span suppressHydrationWarning>{label}</span>;
}

function format(startsAt: string, endsAt: string, tz: string, locale?: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}
