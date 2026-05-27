"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
}

interface ContactSuggestion {
  email: string;
  name: string;
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
  const [inviteeName, setInviteeName] = useState("");
  const [inviteeEmail, setInviteeEmail] = useState("");
  // Initial datetime-local default: next quarter-hour rounded up, in browser tz.
  const [startsLocal, setStartsLocal] = useState(() => defaultDateTimeLocal());
  const [note, setNote] = useState("");
  // When the chosen MT is paid, the host can either book complimentary (default — no payment
  // collected, immediate confirmation) or send the invitee a Stripe Checkout link. Resets to
  // false (= complimentary) every time the MT changes so a previously-toggled "charge" doesn't
  // leak across MT switches.
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

  // Reset the charge toggle whenever the host switches MT — defaulting to complimentary keeps
  // the "no payment by default" rule even when toggling between MTs.
  useEffect(() => {
    setChargeInvitee(false);
  }, [mtId]);

  function pickContact(email: string) {
    const c = contactSuggestions.find((x) => x.email === email);
    if (!c) return;
    setInviteeEmail(c.email);
    if (!inviteeName.trim()) setInviteeName(c.name);
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
    if (inviteeName.trim().length < 2) return setError("Invitee name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail.trim())) {
      return setError("Invitee email looks invalid.");
    }
    if (!startsLocal) return setError("Pick a date and time.");
    const startsAtIso = new Date(startsLocal).toISOString();

    startTransition(async () => {
      const res = await fetch("/api/host-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingTypeId: selectedMt.id,
          startsAt: startsAtIso,
          inviteeName: inviteeName.trim(),
          inviteeEmail: inviteeEmail.trim(),
          note: note.trim() || null,
          // Only meaningful when the MT is paid. Defaults to false so the invitee gets a
          // free confirmation unless the host explicitly opted in to charging.
          chargeInvitee: isPaid ? chargeInvitee : false,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to book.");
        return;
      }
      const data = (await res.json()) as { id: string; kind: "confirmed" | "awaiting-payment" };
      setSuccess({ kind: data.kind });
      setInviteeName("");
      setInviteeEmail("");
      setNote("");
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
          We&apos;ll re-check your calendar for the chosen slot before sending the invite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mt">Meeting type</Label>
          <Select id="mt" value={mtId} onChange={(e) => setMtId(e.target.value)}>
            {meetingTypes.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.label} ({mt.durationMinutes} min{priceFragment(mt)})
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inviteeName">Invitee name</Label>
            <Input
              id="inviteeName"
              value={inviteeName}
              onChange={(e) => setInviteeName(e.target.value)}
              placeholder="Alex Carter"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteeEmail">Invitee email</Label>
            <Input
              id="inviteeEmail"
              type="email"
              value={inviteeEmail}
              onChange={(e) => setInviteeEmail(e.target.value)}
              placeholder="alex@example.com"
              list="contactSuggestions"
              onBlur={() => pickContact(inviteeEmail.trim())}
            />
            <datalist id="contactSuggestions">
              {contactSuggestions.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="startsLocal">When</Label>
          <Input
            id="startsLocal"
            type="datetime-local"
            value={startsLocal}
            onChange={(e) => setStartsLocal(e.target.value)}
            step={300}
          />
          <p className="text-xs text-muted-foreground">
            In your local time zone. We re-check availability against your calendar on submit.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note for the invitee (optional)</Label>
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
        {!invoiceBlocked && isPaid && priceLabel && (
          <div className="rounded-md border border-border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              This is a paid meeting type ({priceLabel}). By default, host-initiated bookings
              are <span className="text-foreground">complimentary</span> — no charge, instant
              calendar invite. Tick the box to send a Stripe payment link instead.
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={chargeInvitee}
                onChange={(e) => setChargeInvitee(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-border accent-foreground"
              />
              <span>
                <span className="text-foreground">Charge {priceLabel} via Stripe</span>
                <span className="block text-xs text-muted-foreground">
                  Invitee gets a payment link; the calendar invite goes out after they pay.
                </span>
              </span>
            </label>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-foreground">
            {success.kind === "confirmed"
              ? "Sent — the calendar invite is in the invitee's inbox."
              : "Sent — the invitee got an email with the payment link."}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={submit} disabled={pending || Boolean(invoiceBlocked)}>
            {pending
              ? "Sending…"
              : isPaid && chargeInvitee
                ? "Send payment link"
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

function defaultDateTimeLocal(): string {
  const now = new Date();
  // Round up to the next 15-minute mark, then add 1 hour as a friendly default.
  const ms = 15 * 60 * 1000;
  const t = new Date(Math.ceil(now.getTime() / ms) * ms + 60 * 60 * 1000);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
