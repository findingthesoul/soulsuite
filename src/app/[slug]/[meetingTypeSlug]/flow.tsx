"use client";

import { useEffect, useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Globe, Video, CreditCard, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { type IntakeField, validateAnswers } from "@/lib/intake";
import { IntakeFieldsRenderer } from "@/components/intake-fields-renderer";
import { Select } from "@/components/ui/select";
import {
  invoiceDetailsSchema,
  SUPPORTED_BILLING_COUNTRIES,
  type BillingCountry,
  type InvoiceDetails,
} from "@/lib/bookings/invoice-details";

interface Host {
  slug: string;
  name: string;
  timezone: string;
}
interface MeetingType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  conferencingProvider:
    | "GOOGLE_MEET"
    | "ZOOM"
    | "TEAMS"
    | "IN_PERSON"
    | "PERSONAL_ROOM"
    | "NONE";
  defaultLocation: string | null;
  priceCents: number | null;
  priceCurrency: string | null;
  paymentMethod: "STRIPE" | "INVOICE" | "ADYEN";
}

// Empty invoice form state — shared between initial render and "Back to billing" navigation.
// Held in flow-level state so going Back from confirm preserves what was typed.
function emptyInvoiceForm(initialEmail: string): InvoiceFormState {
  return {
    companyName: "",
    billingEmail: initialEmail,
    addressLine1: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    country: "NL",
    countryOther: "",
    vatId: "",
    reference: "",
  };
}

interface InvoiceFormState {
  companyName: string;
  billingEmail: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: BillingCountry;
  countryOther: string;
  vatId: string;
  reference: string;
}
interface SerializedSlot {
  startsAt: string;
  endsAt: string;
}

// localStorage key for caching the invitee's invoice details on their own browser. Scoped per
// host slug + email so the same person rebooking on the same device sees their last entries.
// Address-level fields never leave the device — server only knows {name, company} via Contact.
function invoiceCacheKey(hostSlug: string, email: string): string {
  return `soulsuite.invoiceDetails.${hostSlug}.${email.trim().toLowerCase()}`;
}

function readCachedInvoiceForm(hostSlug: string, email: string): Partial<InvoiceFormState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(invoiceCacheKey(hostSlug, email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InvoiceFormState>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedInvoiceForm(hostSlug: string, email: string, form: InvoiceFormState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(invoiceCacheKey(hostSlug, email), JSON.stringify(form));
  } catch {
    // Quota / privacy mode / etc. — silently skip; prefill is a nice-to-have.
  }
}

// Merge a partial prefill into an existing form, never overwriting fields the user already typed.
// "Empty" means the empty string for text fields and the schema default ("NL") for country.
function mergeInvoicePrefill(
  prev: InvoiceFormState,
  patch: Partial<InvoiceFormState>,
): InvoiceFormState {
  const next: InvoiceFormState = { ...prev };
  for (const key of Object.keys(patch) as (keyof InvoiceFormState)[]) {
    const incoming = patch[key];
    if (incoming === undefined || incoming === null || incoming === "") continue;
    const current = prev[key];
    const isEmpty = current === "" || (key === "country" && current === "NL");
    if (isEmpty) {
      // TS narrowing for the union; safe because patch keys come from InvoiceFormState.
      (next as unknown as Record<string, unknown>)[key] = incoming;
    }
  }
  return next;
}

function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// "with X", "with X and Y" (Collective — everyone attends), or "with X or Y" (Round-robin —
// one host is picked at booking time). Personal MTs always go through the SINGLE branch.
function formatWithClause(
  primaryName: string,
  hostNames?: string[] | null,
  routingMode?: "SINGLE" | "ROUND_ROBIN" | "COLLECTIVE",
): string {
  const names = hostNames && hostNames.length > 0 ? hostNames : [primaryName];
  if (names.length === 1) return `with ${names[0]}`;
  const conjunction = routingMode === "ROUND_ROBIN" ? "or" : "and";
  if (names.length === 2) return `with ${names[0]} ${conjunction} ${names[1]}`;
  return `with ${names.slice(0, -1).join(", ")}, ${conjunction} ${names[names.length - 1]}`;
}

export function BookingFlow({
  host,
  meetingType,
  initialSlots,
  projectName,
  hostNames,
  routingMode,
  intakeFields,
}: {
  host: Host;
  meetingType: MeetingType;
  initialSlots: SerializedSlot[];
  projectName?: string | null;
  hostNames?: string[] | null;
  routingMode?: "SINGLE" | "ROUND_ROBIN" | "COLLECTIVE";
  intakeFields: IntakeField[];
}) {
  const router = useRouter();
  // Start with the host's tz so server-rendered HTML matches client first paint. Swap to the
  // browser's detected tz after mount.
  const [tz, setTz] = useState(host.timezone);
  useEffect(() => {
    const detected = detectTz();
    if (detected && detected !== host.timezone) setTz(detected);
  }, [host.timezone]);

  // Group slots by their local date in the invitee's tz, then derive what dates are bookable
  // and which calendar month to display first.
  const slotsByDate = useMemo(() => groupByLocalDate(initialSlots, tz), [initialSlots, tz]);
  const availableDates = useMemo(() => new Set(Object.keys(slotsByDate)), [slotsByDate]);
  const firstDate = useMemo(
    () => [...availableDates].sort()[0] ?? todayKey(tz),
    [availableDates, tz],
  );

  const [displayed, setDisplayed] = useState(() => parseMonth(firstDate));
  const [selectedDate, setSelectedDate] = useState<string | null>(firstDate in slotsByDate ? firstDate : null);
  const [stagedSlot, setStagedSlot] = useState<SerializedSlot | null>(null);
  // 3-step flow for invoice MTs: pick → details → billing → submit. Free + Stripe MTs use just
  // pick → details → submit. State keeps name + email + intake answers + (for invoice) billing
  // hoisted here so navigating back doesn't drop what the user already typed.
  const [step, setStep] = useState<"pick" | "details" | "billing">("pick");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(() => emptyInvoiceForm(""));
  const isInvoice = meetingType.paymentMethod === "INVOICE" && (meetingType.priceCents ?? 0) > 0;

  function selectDate(date: string) {
    setSelectedDate(date);
    setStagedSlot(null);
  }

  function confirmSlot(slot: SerializedSlot) {
    setStagedSlot(slot);
    setStep("details");
  }

  function gotoBilling() {
    // Default the billing email to the invitee email on first visit; preserve any user edit
    // afterwards (we only overwrite if it's still the previously-defaulted value).
    setInvoiceForm((prev) => ({
      ...prev,
      billingEmail: prev.billingEmail.length === 0 ? email : prev.billingEmail,
    }));
    setStep("billing");
    // Prefill in two passes (both fill-only; never overwrite what the invitee already typed):
    //   A. localStorage on this device — full address recall for the same person re-booking.
    //   B. server contact-hint — name + company only, for cross-device "I work at Acme" cases.
    void prefillInvoiceFromHistory();
  }

  async function prefillInvoiceFromHistory() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    const cached = readCachedInvoiceForm(host.slug, trimmedEmail);
    if (cached) {
      setInvoiceForm((prev) => mergeInvoicePrefill(prev, cached));
    }

    try {
      const url = `/api/bookings/contact-hint?meetingTypeId=${encodeURIComponent(
        meetingType.id,
      )}&email=${encodeURIComponent(trimmedEmail.toLowerCase())}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const hint = (await res.json()) as { name: string | null; company: string | null };
      if (!hint.company) return;
      setInvoiceForm((prev) => mergeInvoicePrefill(prev, { companyName: hint.company! }));
    } catch {
      // Network failure — prefill is best-effort, the form still works without it.
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-14">
        <div className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
          <div className="grid md:grid-cols-[280px_1fr]">
            <EventPanel
              host={host}
              meetingType={meetingType}
              tz={tz}
              projectName={projectName}
              hostNames={hostNames}
              routingMode={routingMode}
            />
            <div className="p-6 md:p-8 border-t md:border-t-0 md:border-l border-border min-h-[480px]">
              {step === "pick" && (
                <PickPanel
                  tz={tz}
                  setTz={setTz}
                  displayed={displayed}
                  setDisplayed={setDisplayed}
                  availableDates={availableDates}
                  selectedDate={selectedDate}
                  setSelectedDate={selectDate}
                  slotsByDate={slotsByDate}
                  stagedSlot={stagedSlot}
                  setStagedSlot={setStagedSlot}
                  onConfirm={confirmSlot}
                />
              )}
              {step === "details" && (
                <DetailsPanel
                  slot={stagedSlot}
                  tz={tz}
                  meetingType={meetingType}
                  host={host}
                  intakeFields={intakeFields}
                  isInvoice={isInvoice}
                  name={name}
                  setName={setName}
                  email={email}
                  setEmail={setEmail}
                  answers={answers}
                  setAnswers={setAnswers}
                  onBack={() => setStep("pick")}
                  onBooked={(id) => router.push(`/${host.slug}/${meetingType.slug}/confirmed/${id}`)}
                  onContinueToBilling={gotoBilling}
                  onSlotGone={(message) => {
                    setStep("pick");
                    setStagedSlot(null);
                    router.refresh();
                    if (message) alert(message);
                  }}
                />
              )}
              {step === "billing" && (
                <BillingPanel
                  slot={stagedSlot}
                  tz={tz}
                  meetingType={meetingType}
                  invoiceForm={invoiceForm}
                  setInvoiceForm={setInvoiceForm}
                  name={name}
                  email={email}
                  answers={answers}
                  inviteeTimezone={tz}
                  onBack={() => setStep("details")}
                  onBooked={(id) => {
                    // Cache the just-entered billing block on this device so the same person
                    // rebooking from this browser sees their address fields prefilled next time.
                    saveCachedInvoiceForm(host.slug, email, invoiceForm);
                    router.push(`/${host.slug}/${meetingType.slug}/confirmed/${id}`);
                  }}
                  onSlotGone={(message) => {
                    setStep("pick");
                    setStagedSlot(null);
                    router.refresh();
                    if (message) alert(message);
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-subtle-foreground">
          Powered by Soul Suite
        </p>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// Left column — event metadata
// ────────────────────────────────────────────────────────────

function EventPanel({
  host,
  meetingType,
  tz,
  projectName,
  hostNames,
  routingMode,
}: {
  host: Host;
  meetingType: MeetingType;
  tz: string;
  projectName?: string | null;
  hostNames?: string[] | null;
  routingMode?: "SINGLE" | "ROUND_ROBIN" | "COLLECTIVE";
}) {
  const withClause = formatWithClause(host.name, hostNames, routingMode);
  return (
    <aside className="p-6 md:p-8 bg-surface-muted/40 space-y-5">
      <Avatar name={projectName ?? host.name} size="lg" />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {projectName ? `${projectName}${withClause ? ` · ${withClause}` : ""}` : host.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight leading-tight">{meetingType.name}</h1>
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          <span>{meetingType.durationMinutes} minutes</span>
        </li>
        {meetingType.priceCents != null && meetingType.priceCents > 0 && meetingType.priceCurrency && (
          <>
            <li className="flex items-center gap-2 font-medium text-foreground">
              <CreditCard className="h-4 w-4 shrink-0" />
              <span>
                {formatPriceClient(meetingType.priceCents, meetingType.priceCurrency)}
              </span>
            </li>
            <li className="text-xs text-muted-foreground pl-6 -mt-1">
              Payment: {meetingType.paymentMethod === "INVOICE" ? "Invoice" : "Stripe"}
            </li>
          </>
        )}
        {meetingType.conferencingProvider === "IN_PERSON" ? (
          <li className="flex items-start gap-2">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <span className="block text-foreground font-medium">In person</span>
              {meetingType.defaultLocation && (
                <span className="block text-xs text-muted-foreground whitespace-pre-line">
                  {meetingType.defaultLocation}
                </span>
              )}
            </span>
          </li>
        ) : meetingType.conferencingProvider !== "NONE" ? (
          <li className="flex items-center gap-2">
            <Video className="h-4 w-4 shrink-0" />
            <span>{providerLabel(meetingType.conferencingProvider)} — link in invite</span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Globe className="h-4 w-4 shrink-0" />
          <span>{tz}</span>
        </li>
      </ul>
      {meetingType.description && (
        <p className="pt-3 border-t border-border text-sm text-foreground whitespace-pre-line">
          {meetingType.description}
        </p>
      )}
    </aside>
  );
}

// ────────────────────────────────────────────────────────────
// Right column — calendar grid + time list
// ────────────────────────────────────────────────────────────

function PickPanel({
  tz,
  setTz,
  displayed,
  setDisplayed,
  availableDates,
  selectedDate,
  setSelectedDate,
  slotsByDate,
  stagedSlot,
  setStagedSlot,
  onConfirm,
}: {
  tz: string;
  setTz: (tz: string) => void;
  displayed: { year: number; month: number };
  setDisplayed: (d: { year: number; month: number }) => void;
  availableDates: Set<string>;
  selectedDate: string | null;
  setSelectedDate: (d: string) => void;
  slotsByDate: Record<string, SerializedSlot[]>;
  stagedSlot: SerializedSlot | null;
  setStagedSlot: (s: SerializedSlot | null) => void;
  onConfirm: (s: SerializedSlot) => void;
}) {
  const slots = selectedDate ? slotsByDate[selectedDate] ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Select a date &amp; time</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <CalendarGrid
          displayed={displayed}
          setDisplayed={setDisplayed}
          availableDates={availableDates}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />

        <div className="md:max-h-[360px] md:overflow-y-auto md:pr-1">
          {!selectedDate ? (
            <p className="text-sm text-muted-foreground pt-4">Pick a date to see times.</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-4">No times on this day.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground pb-1">
                {formatLongDate(selectedDate, tz)}
              </p>
              {slots.map((slot) => {
                const isStaged = stagedSlot?.startsAt === slot.startsAt;
                return (
                  <div key={slot.startsAt} className="flex gap-2">
                    <button
                      onClick={() => setStagedSlot(isStaged ? null : slot)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        isStaged
                          ? "border-foreground bg-foreground/5 text-foreground"
                          : "border-border bg-surface text-foreground hover:bg-surface-muted hover:border-border-strong",
                      )}
                    >
                      {formatTime(slot.startsAt, tz)}
                    </button>
                    {isStaged && (
                      <Button size="md" onClick={() => onConfirm(slot)} className="shrink-0">
                        Next
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-border flex flex-wrap items-center gap-3 text-sm">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Time zone:</span>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
        >
          {tzOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Standalone month-view calendar grid. Local logic — works with `tz` only via the date strings
// passed in `availableDates` (already grouped by tz).
function CalendarGrid({
  displayed,
  setDisplayed,
  availableDates,
  selectedDate,
  onSelect,
}: {
  displayed: { year: number; month: number };
  setDisplayed: (d: { year: number; month: number }) => void;
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(displayed.year, displayed.month - 1, 1),
  );

  // First day of the displayed month (0=Sunday). We render Monday-first so subtract.
  const firstDow = new Date(displayed.year, displayed.month - 1, 1).getDay();
  const offset = (firstDow + 6) % 7; // shift Sun=0..Sat=6 to Mon=0..Sun=6
  const daysInMonth = new Date(displayed.year, displayed.month, 0).getDate();

  const cells: ({ key: string; day: number; date: string } | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${displayed.year}-${String(displayed.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ key: date, day: d, date });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: number) {
    let m = displayed.month + delta;
    let y = displayed.year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setDisplayed({ year: y, month: m });
  }

  const today = todayKey("UTC"); // The visual "today" pip — not tz-aware on purpose; close enough.

  return (
    <div>
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm font-medium text-foreground">{monthLabel}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground py-2">
            {d}
          </div>
        ))}
        {cells.map((cell, i) =>
          !cell ? (
            <div key={`empty-${i}`} aria-hidden="true" />
          ) : (
            <DayCell
              key={cell.key}
              date={cell.date}
              day={cell.day}
              isToday={cell.date === today}
              isAvailable={availableDates.has(cell.date)}
              isSelected={selectedDate === cell.date}
              onSelect={onSelect}
            />
          ),
        )}
      </div>
    </div>
  );
}

function DayCell({
  date,
  day,
  isToday,
  isAvailable,
  isSelected,
  onSelect,
}: {
  date: string;
  day: number;
  isToday: boolean;
  isAvailable: boolean;
  isSelected: boolean;
  onSelect: (d: string) => void;
}) {
  const base =
    "relative aspect-square flex items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  if (!isAvailable) {
    return (
      <div className={cn(base, "text-subtle-foreground cursor-not-allowed")} aria-disabled="true">
        <span>{day}</span>
        {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-subtle-foreground" />}
      </div>
    );
  }
  if (isSelected) {
    return (
      <button type="button" onClick={() => onSelect(date)} className={cn(base, "bg-foreground text-background font-medium")}>
        {day}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      className={cn(base, "bg-surface-muted text-foreground font-medium hover:bg-surface-muted/70")}
    >
      {day}
      {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-foreground" />}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Step 2 — invitee details form
// ────────────────────────────────────────────────────────────

function DetailsPanel({
  slot,
  tz,
  meetingType,
  host,
  intakeFields,
  isInvoice,
  name,
  setName,
  email,
  setEmail,
  answers,
  setAnswers,
  onBack,
  onBooked,
  onContinueToBilling,
  onSlotGone,
}: {
  slot: SerializedSlot | null;
  tz: string;
  meetingType: MeetingType;
  host: Host;
  intakeFields: IntakeField[];
  isInvoice: boolean;
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  answers: Record<string, unknown>;
  setAnswers: (next: Record<string, unknown>) => void;
  onBack: () => void;
  onBooked: (id: string) => void;
  onContinueToBilling: () => void;
  onSlotGone: (message?: string) => void;
}) {
  const [intakeErrorKey, setIntakeErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    setIntakeErrorKey(null);
    if (!slot) return setError("Pick a time first.");
    if (name.trim().length < 1) return setError("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");

    const intakeErr = validateAnswers(intakeFields, answers);
    if (intakeErr) {
      setIntakeErrorKey(intakeErr.fieldKey);
      return setError(intakeErr.message);
    }

    // Invoice MTs route through the billing step instead of submitting here. We've already
    // validated the basics, so jumping forward is safe.
    if (isInvoice) {
      onContinueToBilling();
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingTypeId: meetingType.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          inviteeName: name.trim(),
          inviteeEmail: email.trim().toLowerCase(),
          inviteeTimezone: tz,
          intakeAnswers: answers,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) {
          onSlotGone(text || "That slot was just booked. Pick another time.");
          return;
        }
        setError(text || "Failed to create booking.");
        return;
      }
      const data = (await res.json()) as { id: string; checkoutUrl?: string };
      // Paid meeting types: server returns a Stripe Checkout URL → redirect there. The booking
      // is created in PENDING state and the webhook finalises it after payment. Free MTs return
      // just { id } and we go straight to the confirmation page.
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      onBooked(data.id);
    });
  }

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="mt-3 text-base font-semibold tracking-tight">Confirm your details</h2>
        {slot && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatLongDate(slot.startsAt.slice(0, 10), tz)} · {formatTime(slot.startsAt, tz)} —{" "}
            {formatTime(slot.endsAt, tz)}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          A calendar invite from {host.name} will be sent to this email.
        </p>
      </div>

      {intakeFields.length > 0 && (
        <div className="space-y-4 pt-2 border-t border-border">
          <IntakeFieldsRenderer
            fields={intakeFields}
            answers={answers}
            onChange={setAnswers}
            errorKey={intakeErrorKey}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        {pending ? "Booking…" : isInvoice ? "Next: billing details" : "Schedule event"}
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Step 3 (invoice MTs only) — billing details capture
// ────────────────────────────────────────────────────────────

function BillingPanel({
  slot,
  tz,
  meetingType,
  invoiceForm,
  setInvoiceForm,
  name,
  email,
  answers,
  inviteeTimezone,
  onBack,
  onBooked,
  onSlotGone,
}: {
  slot: SerializedSlot | null;
  tz: string;
  meetingType: MeetingType;
  invoiceForm: InvoiceFormState;
  setInvoiceForm: Dispatch<SetStateAction<InvoiceFormState>>;
  name: string;
  email: string;
  answers: Record<string, unknown>;
  inviteeTimezone: string;
  onBack: () => void;
  onBooked: (id: string) => void;
  onSlotGone: (message?: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  function update<K extends keyof InvoiceFormState>(key: K, value: InvoiceFormState[K]) {
    setInvoiceForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    setErrorField(null);
    if (!slot) return setError("Pick a time first.");
    // Re-validate via the canonical schema so client + server stay in lock-step.
    const parsed = invoiceDetailsSchema.safeParse(invoiceForm);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErrorField(typeof issue?.path[0] === "string" ? issue.path[0] : null);
      return setError(issue?.message ?? "Check the billing details.");
    }
    const invoiceDetails: InvoiceDetails = parsed.data;

    startTransition(async () => {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingTypeId: meetingType.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          inviteeName: name.trim(),
          inviteeEmail: email.trim().toLowerCase(),
          inviteeTimezone,
          intakeAnswers: answers,
          invoiceDetails,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) {
          onSlotGone(text || "That slot was just booked. Pick another time.");
          return;
        }
        setError(text || "Failed to create booking.");
        return;
      }
      const data = (await res.json()) as { id: string };
      onBooked(data.id);
    });
  }

  const fieldClass = (key: string) =>
    errorField === key ? "border-destructive focus-visible:ring-destructive" : undefined;

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="mt-3 text-base font-semibold tracking-tight">Billing details</h2>
        {slot && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatLongDate(slot.startsAt.slice(0, 10), tz)} · {formatTime(slot.startsAt, tz)} —{" "}
            {formatTime(slot.endsAt, tz)}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          You&apos;ll receive an invoice from the host after the meeting is booked.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Company / organisation</Label>
          <Input
            id="companyName"
            value={invoiceForm.companyName}
            onChange={(e) => update("companyName", e.target.value)}
            className={fieldClass("companyName")}
            placeholder="Acme Inc."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billingEmail">Billing email</Label>
          <Input
            id="billingEmail"
            type="email"
            value={invoiceForm.billingEmail}
            onChange={(e) => update("billingEmail", e.target.value)}
            className={fieldClass("billingEmail")}
            placeholder="ap@acme.com"
          />
          <p className="text-xs text-muted-foreground">Where the host will send the invoice.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine1">Address line 1</Label>
          <Input
            id="addressLine1"
            value={invoiceForm.addressLine1}
            onChange={(e) => update("addressLine1", e.target.value)}
            className={fieldClass("addressLine1")}
            placeholder="123 Example St."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
          <Input
            id="addressLine2"
            value={invoiceForm.addressLine2}
            onChange={(e) => update("addressLine2", e.target.value)}
            className={fieldClass("addressLine2")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input
              id="postalCode"
              value={invoiceForm.postalCode}
              onChange={(e) => update("postalCode", e.target.value)}
              className={fieldClass("postalCode")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={invoiceForm.city}
              onChange={(e) => update("city", e.target.value)}
              className={fieldClass("city")}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <Select
            id="country"
            value={invoiceForm.country}
            onChange={(e) => update("country", e.target.value as BillingCountry)}
            className={fieldClass("country")}
          >
            {SUPPORTED_BILLING_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {countryLabel(c)}
              </option>
            ))}
          </Select>
        </div>
        {invoiceForm.country === "OTHER" && (
          <div className="space-y-1.5">
            <Label htmlFor="countryOther">Country name</Label>
            <Input
              id="countryOther"
              value={invoiceForm.countryOther}
              onChange={(e) => update("countryOther", e.target.value)}
              className={fieldClass("countryOther")}
              placeholder="Country"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="vatId">VAT / tax ID (optional)</Label>
          <Input
            id="vatId"
            value={invoiceForm.vatId}
            onChange={(e) => update("vatId", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference">Reference / PO number (optional)</Label>
          <Input
            id="reference"
            value={invoiceForm.reference}
            onChange={(e) => update("reference", e.target.value)}
            placeholder="PO-12345"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        {pending ? "Booking…" : "Confirm booking"}
      </Button>
    </div>
  );
}

function countryLabel(c: BillingCountry): string {
  switch (c) {
    case "NL": return "Netherlands";
    case "DE": return "Germany";
    case "BE": return "Belgium";
    case "FR": return "France";
    case "UK": return "United Kingdom";
    case "US": return "United States";
    case "OTHER": return "Other…";
  }
}

// ---------- helpers ----------

function groupByLocalDate(slots: SerializedSlot[], tz: string): Record<string, SerializedSlot[]> {
  const out: Record<string, SerializedSlot[]> = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const slot of slots) {
    const key = formatter.format(new Date(slot.startsAt)); // YYYY-MM-DD in tz
    (out[key] ??= []).push(slot);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}

// Locale is pinned to en-GB so server-rendered HTML matches the client's first paint regardless
// of the visitor's browser locale. Format is unambiguous ("Friday 1 May", "11:45"). Switching
// to the visitor's locale post-mount is possible but requires more state plumbing — defer.

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatLongDate(yyyymmdd: string, tz: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

function todayKey(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseMonth(yyyymmdd: string): { year: number; month: number } {
  const [y, m] = yyyymmdd.split("-").map(Number);
  return { year: y, month: m };
}

function tzOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const list =
    typeof intl.supportedValuesOf === "function"
      ? intl.supportedValuesOf("timeZone")
      : ["Europe/Amsterdam", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"];
  return [...list].sort();
}

function formatPriceClient(priceCents: number, currency: string): string {
  const symbols: Record<string, string> = { eur: "€", usd: "$", gbp: "£" };
  const symbol = symbols[currency.toLowerCase()] ?? currency.toUpperCase() + " ";
  const major = priceCents / 100;
  const formatted = major.toLocaleString("en-US", {
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

function providerLabel(
  p: "GOOGLE_MEET" | "ZOOM" | "TEAMS" | "IN_PERSON" | "PERSONAL_ROOM" | "NONE",
): string {
  switch (p) {
    case "ZOOM": return "Zoom";
    case "TEAMS": return "Microsoft Teams";
    case "IN_PERSON": return "In person";
    case "PERSONAL_ROOM": return "Personal room";
    case "NONE": return "No conferencing";
    default: return "Google Meet";
  }
}
