"use client";

import { useEffect, useState } from "react";

// Renders date + time in the visitor's detected timezone. Server-rendered as UTC, then
// hydrated client-side with the local TZ. Avoids a timezone mismatch warning between server
// render and client display.
export function ConfirmedDateTime({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [label, setLabel] = useState<string>(() => formatUTC(startsAt, endsAt));
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLabel(formatLocal(startsAt, endsAt, tz));
  }, [startsAt, endsAt]);
  return <span>{label}</span>;
}

function formatLocal(startsAt: string, endsAt: string, tz: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)} (${tz})`;
}

function formatUTC(startsAt: string, endsAt: string): string {
  return formatLocal(startsAt, endsAt, "UTC");
}
