"use client";

import { useEffect, useState } from "react";

// Renders date + time in the visitor's detected timezone + locale. SSR can't know the visitor's
// locale (Node defaults to en-US, browsers vary), so we render UTC + en-GB on first paint and
// hydrate the localized version on mount. `suppressHydrationWarning` silences the deliberate
// text mismatch between server and client.
export function ConfirmedDateTime({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [label, setLabel] = useState<string>(() => formatLocal(startsAt, endsAt, "UTC", "en-GB"));
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLabel(formatLocal(startsAt, endsAt, tz));
  }, [startsAt, endsAt]);
  return <span suppressHydrationWarning>{label}</span>;
}

function formatLocal(startsAt: string, endsAt: string, tz: string, locale?: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)} (${tz})`;
}
