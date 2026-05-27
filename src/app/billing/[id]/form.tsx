"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  SUPPORTED_BILLING_COUNTRIES,
  type BillingCountry,
} from "@/lib/bookings/invoice-details";

interface Props {
  bookingId: string;
  token: string;
  inviteeName: string;
  inviteeEmail: string;
  hostName: string;
  meetingTypeName: string;
  startsAtIso: string;
  endsAtIso: string;
  priceCents: number;
  priceCurrency: string;
}

// Public billing form for host-initiated INVOICE bookings. Mirrors the BillingPanel from the
// public booking flow but without slot-picking — the slot is already chosen by the host. On
// submit, POSTs to /api/bookings/[id]/submit-invoice-details and shows a success card.

export function BillingForm({
  bookingId,
  token,
  inviteeName,
  inviteeEmail,
  hostName,
  meetingTypeName,
  startsAtIso,
  endsAtIso,
  priceCents,
  priceCurrency,
}: Props) {
  const [companyName, setCompanyName] = useState("");
  const [billingEmail, setBillingEmail] = useState(inviteeEmail);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState<BillingCountry>("NL");
  const [countryOther, setCountryOther] = useState("");
  const [vatId, setVatId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (companyName.trim().length === 0) return setError("Company name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) {
      return setError("Billing email looks invalid.");
    }
    if (addressLine1.trim().length === 0) return setError("Address line 1 is required.");
    if (postalCode.trim().length === 0) return setError("Postal code is required.");
    if (city.trim().length === 0) return setError("City is required.");
    if (country === "OTHER" && countryOther.trim().length === 0) {
      return setError("Enter the country name.");
    }
    startTransition(async () => {
      const res = await fetch(
        `/api/bookings/${bookingId}/submit-invoice-details?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            companyName: companyName.trim(),
            billingEmail: billingEmail.trim(),
            addressLine1: addressLine1.trim(),
            addressLine2: addressLine2.trim(),
            postalCode: postalCode.trim(),
            city: city.trim(),
            country,
            countryOther: country === "OTHER" ? countryOther.trim() : "",
            vatId: vatId.trim(),
            reference: reference.trim(),
          }),
        },
      );
      if (!res.ok) {
        setError((await res.text()) || "Couldn't submit. Try again.");
        return;
      }
      setDone(true);
    });
  }

  const when = formatRange(startsAtIso, endsAtIso);
  const priceLabel = formatPrice(priceCents, priceCurrency);

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Booking confirmed</CardTitle>
          <CardDescription>
            Thanks {inviteeName}. {hostName} will send you the invoice for{" "}
            <strong>{priceLabel}</strong> separately. A calendar invite for{" "}
            <strong>{meetingTypeName}</strong> on <strong>{when}</strong> is on its way to{" "}
            <strong>{inviteeEmail}</strong>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Confirm your billing details</CardTitle>
          <CardDescription>
            For your meeting with <strong>{hostName}</strong>: {meetingTypeName} ·{" "}
            <span className="whitespace-nowrap">{when}</span> · <strong>{priceLabel}</strong>.
            Fill these in and we&apos;ll send the calendar invite to{" "}
            <span className="whitespace-nowrap">{inviteeEmail}</span>. The invoice follows
            separately from {hostName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company / billed to</Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billingEmail">Billing email</Label>
            <Input
              id="billingEmail"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Where the invoice should be sent. Default is your meeting email.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addressLine1">Address line 1</Label>
            <Input
              id="addressLine1"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="Street + number"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
            <Input
              id="addressLine2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="postalCode">Postal code</Label>
              <Input
                id="postalCode"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <Select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value as BillingCountry)}
            >
              {SUPPORTED_BILLING_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {countryLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          {country === "OTHER" && (
            <div className="space-y-1.5">
              <Label htmlFor="countryOther">Country name</Label>
              <Input
                id="countryOther"
                value={countryOther}
                onChange={(e) => setCountryOther(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="vatId">VAT / tax ID (optional)</Label>
            <Input id="vatId" value={vatId} onChange={(e) => setVatId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference / PO (optional)</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end pt-1">
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Confirm booking"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
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
    case "OTHER": return "Other";
  }
}

function formatPrice(cents: number, currency: string): string {
  const symbols: Record<string, string> = { eur: "€", usd: "$", gbp: "£" };
  const symbol = symbols[currency.toLowerCase()] ?? currency.toUpperCase() + " ";
  const major = cents / 100;
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function formatRange(startsIso: string, endsIso: string): string {
  const start = new Date(startsIso);
  const end = new Date(endsIso);
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}
