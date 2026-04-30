// Minimal iCalendar (RFC 5545) generator. Hand-rolled because we only need a single VEVENT and
// pulling a library would be overkill. iCal is line-folded at 75 octets — for our short fields
// (subject, ~200 char description, two emails, two URLs) we stay well below the limit.

interface IcalEventInput {
  uid: string; // stable per booking
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description?: string;
  location?: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  status?: "CONFIRMED" | "CANCELLED";
  // RFC 5545 wants every event timestamp + DTSTAMP. Default = now.
  generatedAt?: Date;
}

export function buildBookingIcal(args: IcalEventInput): string {
  const dtstamp = formatUtc(args.generatedAt ?? new Date());
  const dtstart = formatUtc(args.startsAt);
  const dtend = formatUtc(args.endsAt);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Soul Suite//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(args.summary)}`,
    args.description ? `DESCRIPTION:${escapeText(args.description)}` : null,
    args.location ? `LOCATION:${escapeText(args.location)}` : null,
    `ORGANIZER;CN=${escapeParam(args.organizerName)}:mailto:${args.organizerEmail}`,
    `ATTENDEE;CN=${escapeParam(args.attendeeName)};RSVP=FALSE:mailto:${args.attendeeEmail}`,
    `STATUS:${args.status ?? "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);

  // CRLF line endings per RFC 5545.
  return lines.join("\r\n") + "\r\n";
}

function formatUtc(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Per RFC 5545 §3.3.11 — escape backslash, semicolon, comma, and newline in TEXT values.
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Parameter values can't contain double-quotes, semicolons, colons, or commas without quoting —
// for simplicity we just strip those.
function escapeParam(s: string): string {
  return s.replace(/[";:,]/g, " ").replace(/\s+/g, " ").trim();
}
