"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  BookingDetailDialog,
  type BookingDetail,
} from "@/components/booking-detail-dialog";

interface MtOption {
  id: string;
  label: string;
  name: string;
  slug: string;
  durationMinutes: number;
  priceCents: number | null;
  priceCurrency: string | null;
  paymentMethod: "STRIPE" | "INVOICE" | "ADYEN";
  maxInvitees: number;
  maxAdvanceDays: number;
}

interface ContactSuggestion {
  email: string;
  name: string;
  // True when this email belongs to a Host on the current workspace (i.e. a teammate with
  // an account on Soul Suite). Surfaces a "Member" hint in the datalist so the host can tell
  // internal teammates apart from external contacts at a glance.
  isMember?: boolean;
}

interface InviteeDraft {
  name: string;
  email: string;
}

interface SlotSummary {
  startsAt: string;
  endsAt: string;
}

export function BookForm({
  hostName,
  hostSlug,
  meetingTypes,
  contactSuggestions,
}: {
  hostName: string;
  hostSlug: string;
  meetingTypes: MtOption[];
  contactSuggestions: ContactSuggestion[];
}) {
  const router = useRouter();
  const [mtId, setMtId] = useState(meetingTypes[0]?.id ?? "");
  const [invitees, setInvitees] = useState<InviteeDraft[]>([{ name: "", email: "" }]);
  const [note, setNote] = useState("");
  // Selected slot ISO. null until the host picks one from the availability list.
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  // Loaded slots for the selected MT — fetched from /api/host-bookings/slots whenever the
  // MT changes.
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  // When PAID is toggled on (paid MTs only), invitee gets a Stripe Checkout link. Default off
  // = complimentary booking. Resets to off whenever the MT changes.
  const [chargeInvitee, setChargeInvitee] = useState(false);
  // Optional companion to PAID: when on, the reservation is gated on payment / billing being
  // completed (no Google event until then). When off (default), the calendar invite goes out
  // immediately and the payment/billing link is a follow-up.
  const [requirePayment, setRequirePayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | {
        kind:
          | "confirmed"
          | "awaiting-payment"
          | "awaiting-billing-details"
          | "confirmed-awaiting-payment"
          | "confirmed-awaiting-billing";
        booking: BookingDetail;
      }
    | null
  >(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selectedMt = useMemo(
    () => meetingTypes.find((mt) => mt.id === mtId) ?? null,
    [meetingTypes, mtId],
  );
  const isPaid = Boolean(selectedMt && (selectedMt.priceCents ?? 0) > 0);
  const isInvoiceMt =
    isPaid && selectedMt?.paymentMethod === "INVOICE";
  const priceLabel =
    selectedMt && isPaid && selectedMt.priceCurrency && selectedMt.priceCents
      ? formatPriceClient(selectedMt.priceCents, selectedMt.priceCurrency)
      : null;
  const allowsGroup = (selectedMt?.maxInvitees ?? 1) > 1;
  // Paid+charge collapses to single-invitee for both Stripe and INVOICE rails: billing /
  // payment is per-person, so we don't let the host bundle more than one.
  const canAddInvitee =
    allowsGroup && invitees.length < (selectedMt?.maxInvitees ?? 1) && !(isPaid && chargeInvitee);

  // Reset state when MT changes — clearing slot/charge/invitee count avoids cross-MT leaks.
  useEffect(() => {
    setChargeInvitee(false);
    setRequirePayment(false);
    setSelectedStartsAt(null);
    setInvitees((prev) => (prev.length > 1 ? [prev[0]] : prev));
    setError(null);
    setSuccess(null);
  }, [mtId]);

  // Unchecking PAID also clears the strict-mode sub-toggle so it can't linger invisibly.
  useEffect(() => {
    if (!chargeInvitee) setRequirePayment(false);
  }, [chargeInvitee]);

  // Fetch availability whenever the MT changes. Range: next 14 days.
  useEffect(() => {
    if (!selectedMt) {
      setSlots([]);
      return;
    }
    let aborted = false;
    setSlotsLoading(true);
    const from = new Date().toISOString();
    // Honour the MT's maxAdvanceDays so an MT that allows 60-day-out bookings actually shows
    // the full window. The slots API itself also caps at 60 days for safety against bad
    // callers — we mirror that cap here so the host sees a reasonable date row.
    const advanceDays = Math.min(60, Math.max(1, selectedMt.maxAdvanceDays));
    const to = new Date(Date.now() + advanceDays * 24 * 60 * 60 * 1000).toISOString();
    fetch(
      `/api/host-bookings/slots?mtId=${encodeURIComponent(selectedMt.id)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error((await res.text()) || "Failed to load availability");
        }
        return (await res.json()) as { slots: SlotSummary[] };
      })
      .then((data) => {
        if (aborted) return;
        setSlots(data.slots);
      })
      .catch(() => {
        if (!aborted) setSlots([]);
      })
      .finally(() => {
        if (!aborted) setSlotsLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [selectedMt]);

  // Group slots by local date (browser tz) for the date picker.
  const slotsByDate = useMemo(() => {
    const out = new Map<string, SlotSummary[]>();
    for (const s of slots) {
      const d = new Date(s.startsAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = out.get(key) ?? [];
      arr.push(s);
      out.set(key, arr);
    }
    return out;
  }, [slots]);

  const availableDates = useMemo(
    () => Array.from(slotsByDate.keys()).sort(),
    [slotsByDate],
  );

  // Group dates by YYYY-MM for the month tab strip. With a 60-day window this is at most
  // three months, so we can list them all without further nesting. Each month renders the
  // count of days that have availability — the count next to each day shows slots/day.
  const monthsByKey = useMemo(() => {
    const out = new Map<string, { dates: string[]; slotCount: number }>();
    for (const dateKey of availableDates) {
      const monthKey = dateKey.slice(0, 7); // "YYYY-MM"
      const entry = out.get(monthKey) ?? { dates: [], slotCount: 0 };
      entry.dates.push(dateKey);
      entry.slotCount += slotsByDate.get(dateKey)?.length ?? 0;
      out.set(monthKey, entry);
    }
    return out;
  }, [availableDates, slotsByDate]);
  const availableMonths = useMemo(
    () => Array.from(monthsByKey.keys()).sort(),
    [monthsByKey],
  );
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Default selectedMonth + selectedDate to the first available whenever the slot list
  // changes. Also keep them in sync: if the selected date drifts out of the selected month
  // (e.g. host picked a different MT), snap to a sensible default.
  useEffect(() => {
    if (availableMonths.length === 0) {
      setSelectedMonth(null);
      setSelectedDate(null);
      return;
    }
    const month =
      selectedMonth && monthsByKey.has(selectedMonth)
        ? selectedMonth
        : availableMonths[0];
    if (month !== selectedMonth) setSelectedMonth(month);
    const monthDates = monthsByKey.get(month)?.dates ?? [];
    if (monthDates.length === 0) {
      setSelectedDate(null);
      return;
    }
    if (!selectedDate || !monthDates.includes(selectedDate)) {
      setSelectedDate(monthDates[0]);
    }
  }, [availableMonths, monthsByKey, selectedMonth, selectedDate]);

  function pickContact(email: string, idx: number) {
    const c = contactSuggestions.find((x) => x.email === email);
    if (!c) return;
    setInvitees((prev) => {
      const next = [...prev];
      const row = next[idx];
      next[idx] = {
        email: c.email,
        name: row.name.trim() ? row.name : c.name,
      };
      return next;
    });
  }

  function updateInvitee(idx: number, patch: Partial<InviteeDraft>) {
    setInvitees((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addInvitee() {
    setInvitees((prev) => [...prev, { name: "", email: "" }]);
  }
  function removeInvitee(idx: number) {
    setInvitees((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    setError(null);
    setSuccess(null);
    if (!selectedMt) return setError("Pick a meeting type.");
    if (invitees.length === 0) return setError("Add at least one invitee.");
    for (let i = 0; i < invitees.length; i++) {
      const inv = invitees[i];
      if (inv.name.trim().length < 2) {
        return setError(`Invitee ${i + 1}: name is required.`);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email.trim())) {
        return setError(`Invitee ${i + 1}: email looks invalid.`);
      }
    }
    if (invitees.length > selectedMt.maxInvitees) {
      return setError(`This meeting type allows at most ${selectedMt.maxInvitees} invitees.`);
    }
    if (isPaid && chargeInvitee && invitees.length > 1) {
      return setError(
        "PAID + multiple invitees isn't supported. Untick PAID, or remove the extra invitees.",
      );
    }
    if (!selectedStartsAt) return setError("Pick an available time.");

    startTransition(async () => {
      const res = await fetch("/api/host-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingTypeId: selectedMt.id,
          startsAt: selectedStartsAt,
          invitees: invitees.map((i) => ({
            name: i.name.trim(),
            email: i.email.trim(),
          })),
          note: note.trim() || null,
          chargeInvitee: isPaid ? chargeInvitee : false,
          requirePayment: isPaid && chargeInvitee ? requirePayment : false,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to book.");
        return;
      }
      const data = (await res.json()) as {
        id: string;
        kind:
          | "confirmed"
          | "awaiting-payment"
          | "awaiting-billing-details"
          | "confirmed-awaiting-payment"
          | "confirmed-awaiting-billing";
      };

      // Map the wire status to the dialog's BookingDetail.status. "Confirmed" variants land
      // as CONFIRMED; the strict "awaiting-payment / awaiting-billing-details" variants land
      // as PENDING_APPROVAL so the amber pill signals the slot is held but not yet final.
      const dialogStatus =
        data.kind === "confirmed" ||
        data.kind === "confirmed-awaiting-payment" ||
        data.kind === "confirmed-awaiting-billing"
          ? ("CONFIRMED" as const)
          : ("PENDING_APPROVAL" as const);
      const firstInvitee = invitees[0];
      const dialogNote =
        data.kind === "confirmed-awaiting-payment"
          ? "Calendar invite sent. Invitee got a follow-up email with the Stripe payment link."
          : data.kind === "confirmed-awaiting-billing"
            ? "Calendar invite sent. Invitee got a follow-up email with the billing-details form."
            : data.kind === "awaiting-payment"
              ? "Slot held — calendar invite goes out once the invitee pays."
              : data.kind === "awaiting-billing-details"
                ? "Slot held — calendar invite goes out once the invitee submits billing details."
                : invitees.length > 1
                  ? `Calendar invite sent to ${invitees.length} invitees.`
                  : "Calendar invite sent.";

      const startsAtIso = selectedStartsAt!;
      const endsAtIso = new Date(
        new Date(startsAtIso).getTime() + selectedMt.durationMinutes * 60_000,
      ).toISOString();

      setSuccess({
        kind: data.kind,
        booking: {
          id: data.id,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          status: dialogStatus,
          inviteeName: firstInvitee.name.trim(),
          inviteeEmail: firstInvitee.email.trim(),
          // We don't know meetUrl / conferencing details until after finalize, but the dialog
          // tolerates these being null — the host can click "Open booking page" for the full
          // record once the deploy hits production.
          meetUrl: null,
          conferencingProvider: "GOOGLE_MEET",
          alternativeLocation: null,
          meetingTypeName: selectedMt.name,
          meetingTypeSlug: selectedMt.slug,
          defaultLocation: null,
          hostName,
          hostSlug,
          projectSlug: null,
          note: dialogNote,
        },
      });
      setDialogOpen(true);
      setInvitees([{ name: "", email: "" }]);
      setNote("");
      setSelectedStartsAt(null);
      router.refresh();
    });
  }

  if (meetingTypes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No meeting types yet</CardTitle>
          <CardDescription>
            Create at least one meeting type on{" "}
            <a href="/dashboard/meeting-types" className="underline">your personal page</a> before
            inviting someone directly.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Pick a slot the calendar actually has free, then send the invite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mt">Meeting type</Label>
          <Select id="mt" value={mtId} onChange={(e) => setMtId(e.target.value)}>
            {meetingTypes.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.label} ({mt.durationMinutes} min{priceFragment(mt)}
                {mt.maxInvitees > 1 ? ` · up to ${mt.maxInvitees} invitees` : ""})
              </option>
            ))}
          </Select>
        </div>

        {/* PAID toggle — visible only when the MT has a price. Default OFF = comp'd.
            For INVOICE MTs the on-state sends an invoice-details link; for STRIPE the
            invitee gets a Stripe Checkout URL. */}
        {isPaid && priceLabel && (
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={chargeInvitee}
                onChange={(e) => setChargeInvitee(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-border accent-foreground"
              />
              <span className="flex-1">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={
                      chargeInvitee
                        ? "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium bg-foreground text-background"
                        : "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium bg-surface-muted text-muted-foreground"
                    }
                  >
                    Paid
                  </span>
                  <span className="text-foreground font-medium">
                    Charge {priceLabel}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground mt-1">
                  {chargeInvitee
                    ? isInvoiceMt
                      ? requirePayment
                        ? "Slot held until the invitee submits billing details. Calendar invite goes out only after they do."
                        : "Calendar invite goes out immediately; the invitee gets a follow-up email with the billing-details form."
                      : requirePayment
                        ? "Slot held until the invitee completes payment. Calendar invite goes out only after they do."
                        : "Calendar invite goes out immediately; the invitee gets a follow-up email with the Stripe payment link."
                    : "Complimentary — invitee gets the calendar invite immediately, no charge."}
                </span>
              </span>
            </label>
            {chargeInvitee && (
              <label className="flex items-start gap-2 cursor-pointer pl-7">
                <input
                  type="checkbox"
                  checked={requirePayment}
                  onChange={(e) => setRequirePayment(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-border accent-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  <span className="text-foreground">
                    Don&apos;t confirm until {isInvoiceMt ? "billing details are submitted" : "payment is completed"}
                  </span>
                  {" · "}
                  Default off: the meeting goes ahead regardless of {isInvoiceMt ? "billing" : "payment"}.
                </span>
              </label>
            )}
          </div>
        )}

        {/* Invitees — array with + and trash to manage. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Invitees</Label>
            {allowsGroup && (
              <span className="text-xs text-muted-foreground">
                Up to {selectedMt?.maxInvitees} for this meeting type
              </span>
            )}
          </div>
          <div className="space-y-2">
            {invitees.map((row, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-start">
                <Input
                  value={row.name}
                  onChange={(e) => updateInvitee(idx, { name: e.target.value })}
                  placeholder="Name"
                  aria-label={`Invitee ${idx + 1} name`}
                />
                <Input
                  type="email"
                  value={row.email}
                  onChange={(e) => updateInvitee(idx, { email: e.target.value })}
                  onBlur={() => pickContact(row.email.trim(), idx)}
                  placeholder="email@example.com"
                  list={`contacts-${idx}`}
                  aria-label={`Invitee ${idx + 1} email`}
                />
                <datalist id={`contacts-${idx}`}>
                  {contactSuggestions.map((c) => (
                    <option key={c.email} value={c.email}>
                      {c.isMember ? `${c.name} · Member` : c.name}
                    </option>
                  ))}
                </datalist>
                {invitees.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeInvitee(idx)}
                    aria-label={`Remove invitee ${idx + 1}`}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-surface text-muted-foreground hover:text-destructive hover:bg-surface-muted shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canAddInvitee && (
            <button
              type="button"
              onClick={addInvitee}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              Add invitee
            </button>
          )}
          {!allowsGroup && (
            <p className="text-xs text-muted-foreground">
              This meeting type is 1:1. To invite multiple people in one go, set the max
              invitees on the meeting type higher than 1.
            </p>
          )}
        </div>

        {/* When — dates on the left, times for the selected date on the right. Mirrors the
            public booking page so the host's mental model is the same. While availability
            is loading, both columns render with skeleton pills the user can't click. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>When</Label>
            {slotsLoading && (
              <span className="text-xs text-muted-foreground">Loading availability…</span>
            )}
          </div>
          {slotsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 opacity-50 pointer-events-none">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-surface-muted h-9 animate-pulse"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 opacity-50 pointer-events-none">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-surface-muted h-9 w-20 animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : availableDates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No availability in the next 14 days. Check your working hours and calendar
              conflicts in <a href="/settings/availability" className="underline">Settings</a>.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
              {/* Dates column — month tabs above, then the days within the selected month.
                  With a 60-day window we get at most three months; the tabs keep the list
                  navigable without scrolling through every day. */}
              <div className="flex flex-col gap-2">
                {availableMonths.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {availableMonths.map((monthKey) => {
                      const entry = monthsByKey.get(monthKey);
                      const active = monthKey === selectedMonth;
                      const d = new Date(`${monthKey}-01T12:00:00`);
                      return (
                        <button
                          key={monthKey}
                          type="button"
                          onClick={() => {
                            setSelectedMonth(monthKey);
                            setSelectedStartsAt(null);
                          }}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                            active
                              ? "bg-foreground text-background"
                              : "border border-border bg-surface text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <span>
                            {d.toLocaleDateString(undefined, {
                              month: "short",
                              year: "2-digit",
                            })}
                          </span>
                          <span className={active ? "opacity-70" : "text-subtle-foreground"}>
                            {entry?.slotCount ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                  {(selectedMonth ? monthsByKey.get(selectedMonth)?.dates ?? [] : []).map(
                    (dateKey) => {
                      const d = new Date(`${dateKey}T12:00:00`);
                      const active = dateKey === selectedDate;
                      const count = slotsByDate.get(dateKey)?.length ?? 0;
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          onClick={() => {
                            setSelectedDate(dateKey);
                            setSelectedStartsAt(null);
                          }}
                          className={`text-left rounded-md px-3 py-2 text-xs font-medium transition-colors flex items-center justify-between gap-3 ${
                            active
                              ? "bg-foreground text-background"
                              : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                          }`}
                        >
                          <span>
                            {d.toLocaleDateString(undefined, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                          <span className={active ? "opacity-70" : "text-muted-foreground"}>
                            {count}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
              {/* Slots column — populated from the selected date. */}
              <div className="flex flex-wrap gap-1.5 content-start">
                {selectedDate && slotsByDate.get(selectedDate)
                  ? slotsByDate.get(selectedDate)!.map((s) => {
                      const active = selectedStartsAt === s.startsAt;
                      const label = new Date(s.startsAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <button
                          key={s.startsAt}
                          type="button"
                          onClick={() => setSelectedStartsAt(s.startsAt)}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                            active
                              ? "bg-foreground text-background"
                              : "border border-border bg-surface text-foreground hover:bg-surface-muted"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })
                  : (
                    <p className="text-xs text-muted-foreground">Pick a date on the left.</p>
                  )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note for the invitee{invitees.length > 1 ? "s" : ""} (optional)</Label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What this meeting is about, any prep, etc."
            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="text-sm text-foreground underline hover:no-underline"
          >
            Sent — view booking details
          </button>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={submit} disabled={pending || !selectedStartsAt}>
            {pending
              ? "Sending…"
              : isPaid && chargeInvitee
                ? isInvoiceMt
                  ? "Send billing form"
                  : "Send payment link"
                : invitees.length > 1
                  ? `Send invites (${invitees.length})`
                  : "Send invite"}
          </Button>
        </div>
      </CardContent>
      <BookingDetailDialog
        booking={success?.booking ?? null}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Card>
  );
}

function priceFragment(mt: MtOption): string {
  if (!mt.priceCents || !mt.priceCurrency) return "";
  return ` · ${formatPriceClient(mt.priceCents, mt.priceCurrency)}`;
}

function formatPriceClient(cents: number, currency: string): string {
  const symbols: Record<string, string> = { eur: "€", usd: "$", gbp: "£" };
  const symbol = symbols[currency.toLowerCase()] ?? currency.toUpperCase() + " ";
  const major = cents / 100;
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
