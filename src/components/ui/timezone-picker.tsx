"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Single source of truth for the timezone picker. Searchable typeahead — same component used
// on /onboarding/working-hours, /settings/availability, the contact form, and the public
// booking page. Users type a city ("amst", "tokyo", "auckland") and the list filters.
//
// Implementation: controlled <input> + popover with a filtered virtual list. No external dep;
// keyboard support via arrow keys / Home / End / Enter / Escape. Items are the raw IANA zone
// strings ("Europe/Amsterdam"), but matching is case-insensitive and ignores the slash so that
// "amst" finds "Europe/Amsterdam" and "new york" finds "America/New_York".
//
// For SSR safety: `Intl.supportedValuesOf("timeZone")` runs on the client only via useMemo.
// The fallback list covers the common ones if the runtime doesn't support it.

const FALLBACK_TZS = [
  "UTC",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Curacao",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

function getAllTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: "timeZone") => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      const list = intl.supportedValuesOf("timeZone");
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // fall through
    }
  }
  return FALLBACK_TZS;
}

// Lowercase + replace _ and / with spaces so a query like "new york" matches America/New_York.
function normalise(s: string): string {
  return s.toLowerCase().replace(/[_/]/g, " ");
}

function offsetMinutes(tz: string, now: Date): number | null {
  // Computes the UTC offset of `tz` at `now`, in minutes, by parsing the formatted parts.
  // Falls back to null if Intl rejects the zone.
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(now);
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(off);
    if (!m) return tz === "UTC" || off === "GMT" ? 0 : null;
    const sign = m[1] === "-" ? -1 : 1;
    const hours = Number(m[2]);
    const mins = m[3] ? Number(m[3]) : 0;
    return sign * (hours * 60 + mins);
  } catch {
    return null;
  }
}

function formatOffset(off: number | null): string {
  if (off === null) return "";
  if (off === 0) return "UTC";
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

interface Props {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function TimezonePicker({
  id,
  value,
  onChange,
  placeholder = "Search city or zone…",
  disabled,
  className,
}: Props) {
  const allZones = React.useMemo(() => getAllTimezones(), []);
  const now = React.useMemo(() => new Date(), []);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Filter + rank: prefix match wins, then substring, then everything else.
  const filtered = React.useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return allZones.slice(0, 200);
    const exact: string[] = [];
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const tz of allZones) {
      const n = normalise(tz);
      if (n === q) exact.push(tz);
      else if (n.startsWith(q)) prefix.push(tz);
      else if (n.includes(q)) sub.push(tz);
    }
    return [...exact, ...prefix, ...sub].slice(0, 200);
  }, [allZones, query]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Keep highlighted item in view as the user arrows through.
  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function commit(tz: string) {
    onChange(tz);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      setHighlight(0);
    } else if (e.key === "End") {
      setHighlight(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) commit(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  const display = open ? query : value;
  const inputCls = cn(
    "flex h-9 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "pl-8 pr-8",
  );

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-list` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={display}
        placeholder={value ? value : placeholder}
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
            setHighlight(0);
          }
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKey}
        className={inputCls}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          id={id ? `${id}-list` : undefined}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface shadow-md"
        >
          {filtered.map((tz, idx) => {
            const off = formatOffset(offsetMinutes(tz, now));
            const isSelected = tz === value;
            const isHighlighted = idx === highlight;
            return (
              <button
                key={tz}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-idx={idx}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  // mousedown so we commit before the input's blur closes the popover.
                  e.preventDefault();
                  commit(tz);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                  isHighlighted ? "bg-surface-muted" : "",
                  "hover:bg-surface-muted",
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isSelected ? (
                    <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate text-foreground">{tz}</span>
                </span>
                {off && (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {off}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-surface shadow-md p-3 text-sm text-muted-foreground">
          No matching time zones.
        </div>
      )}
    </div>
  );
}
