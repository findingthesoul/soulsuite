"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface MtOption {
  id: string;
  label: string;
  durationMinutes: number;
  priceCents: number | null;
  priceCurrency: string | null;
  paymentMethod: "STRIPE" | "INVOICE" | "ADYEN";
  maxInvitees: number;
}

interface ContactSuggestion {
  email: string;
  name: string;
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
  hostName: _hostName,
  meetingTypes,
  contactSuggestions,
}: {
  hostName: string;
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ kind: "confirmed" | "awaiting-payment" } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedMt = useMemo(
    () => meetingTypes.find((mt) => mt.id === mtId) ?? null,
    [meetingTypes, mtId],
  );
  const invoiceBlocked =
    selectedMt &&
    (selectedMt.priceCents ?? 0) > 0 &&
    selectedMt.paymentMethod === "INVOICE";
  const isPaid = Boolean(selectedMt && (selectedMt.priceCents ?? 0) > 0);
  const priceLabel =
    selectedMt && isPaid && selectedMt.priceCurrency && selectedMt.priceCents
      ? formatPriceClient(selectedMt.priceCents, selectedMt.priceCurrency)
      : null;
  const allowsGroup = (selectedMt?.maxInvitees ?? 1) > 1;
  const canAddInvitee =
    allowsGroup && invitees.length < (selectedMt?.maxInvitees ?? 1) && !(isPaid && chargeInvitee);

  // Reset state when MT changes — clearing slot/charge/invitee count avoids cross-MT leaks.
  useEffect(() => {
    setChargeInvitee(false);
    setSelectedStartsAt(null);
    setInvitees((prev) => (prev.length > 1 ? [prev[0]] : prev));
    setError(null);
    setSuccess(null);
  }, [mtId]);

  // Fetch availability whenever the MT changes. Range: next 14 days.
  useEffect(() => {
    if (!selectedMt) {
      setSlots([]);
      return;
    }
    let aborted = false;
    setSlotsLoading(true);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Default selectedDate to first available whenever the slot list changes.
  useEffect(() => {
    if (availableDates.length === 0) {
      setSelectedDate(null);
    } else if (!selectedDate || !slotsByDate.has(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate, slotsByDate]);

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
    if (invoiceBlocked) {
      return setError(
        "Invoice meeting types can't be host-initiated yet. Send the invitee your public link instead.",
      );
    }
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
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to book.");
        return;
      }
      const data = (await res.json()) as { id: string; kind: "confirmed" | "awaiting-payment" };
      setSuccess({ kind: data.kind });
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

        {/* PAID toggle — visible only when the MT has a price. Default OFF = comp'd. */}
        {!invoiceBlocked && isPaid && priceLabel && (
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
                    ? "Invitee gets a Stripe payment link; the calendar invite goes out after they pay."
                    : "Complimentary — invitee gets the calendar invite immediately, no charge."}
                </span>
              </span>
            </label>
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
                      {c.name}
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

        {/* When — date + slot list. */}
        <div className="space-y-2">
          <Label>When</Label>
          {slotsLoading && (
            <p className="text-xs text-muted-foreground">Loading availability…</p>
          )}
          {!slotsLoading && availableDates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No availability in the next 14 days. Check your working hours and calendar
              conflicts in <a href="/settings/availability" className="underline">Settings</a>.
            </p>
          )}
          {availableDates.length > 0 && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {availableDates.slice(0, 14).map((dateKey) => {
                  const d = new Date(`${dateKey}T12:00:00`);
                  const active = dateKey === selectedDate;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => {
                        setSelectedDate(dateKey);
                        setSelectedStartsAt(null);
                      }}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? "bg-foreground text-background"
                          : "border border-border bg-surface text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d.toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </button>
                  );
                })}
              </div>
              {selectedDate && slotsByDate.get(selectedDate) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {slotsByDate.get(selectedDate)!.map((s) => {
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
                  })}
                </div>
              )}
            </>
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

        {invoiceBlocked && (
          <p className="text-xs text-destructive">
            Invoice-method paid meeting types can&apos;t be host-initiated. Use the public booking
            link for those.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-foreground">
            {success.kind === "confirmed"
              ? `Sent — the calendar invite${invitees.length > 1 ? "s are" : " is"} in the invitee${invitees.length > 1 ? "s'" : "'s"} inbox.`
              : "Sent — the invitee got an email with the payment link."}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button
            onClick={submit}
            disabled={pending || Boolean(invoiceBlocked) || !selectedStartsAt}
          >
            {pending
              ? "Sending…"
              : isPaid && chargeInvitee
                ? "Send payment link"
                : invitees.length > 1
                  ? `Send invites (${invitees.length})`
                  : "Send invite"}
          </Button>
        </div>
      </CardContent>
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
