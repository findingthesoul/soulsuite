"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";
import { useDirtyState } from "@/lib/use-dirty-state";

type InvoiceSource = "EXTERNAL" | "SOUL_SUITE";

interface Initial {
  stripeAccountId: string | null;
  invoiceSource: InvoiceSource;
  adyenMerchantAccount: string | null;
}

interface Draft {
  stripeAccountId: string;
  invoiceSource: InvoiceSource;
  adyenMerchantAccount: string;
}

const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]+$/;

export function PaymentsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, dirty, update, discard, commit } = useDirtyState<Draft>({
    stripeAccountId: initial.stripeAccountId ?? "",
    invoiceSource: initial.invoiceSource,
    adyenMerchantAccount: initial.adyenMerchantAccount ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const value = draft.stripeAccountId.trim();
    if (value && !ACCOUNT_ID_RE.test(value)) {
      return setError("Stripe account IDs look like acct_xxx (letters and digits after the prefix).");
    }
    if (draft.invoiceSource === "SOUL_SUITE" && !value) {
      return setError("Connect a Stripe account before enabling Soul Suite invoice delivery.");
    }
    const adyen = draft.adyenMerchantAccount.trim();
    if (adyen && !/^[A-Za-z0-9._-]{1,80}$/.test(adyen)) {
      return setError(
        "Adyen merchant account names use letters, digits, dot, dash, or underscore (max 80 chars).",
      );
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/stripe-account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stripeAccountId: value || null,
          invoiceSource: draft.invoiceSource,
          adyenMerchantAccount: adyen || null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit({
        stripeAccountId: value,
        invoiceSource: draft.invoiceSource,
        adyenMerchantAccount: adyen,
      });
      router.refresh();
    });
  }

  const connected = Boolean(initial.stripeAccountId);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Connect your Stripe account so paid meeting types can collect payment before the booking is
            confirmed.
          </p>
        </div>
        <SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />
      </header>
      <DirtyNavGuard dirty={dirty} onSave={save} />

      <Card>
        <CardHeader>
          <CardTitle>Stripe account</CardTitle>
          <CardDescription>
            Soul Suite uses Stripe Connect Standard with direct charges — payments go to your account,
            not ours. Paste your account ID below. Find it under{" "}
            <a
              href="https://dashboard.stripe.com/settings/account"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Stripe Dashboard → Account settings
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stripeAccountId">Account ID</Label>
            <Input
              id="stripeAccountId"
              value={draft.stripeAccountId}
              onChange={(e) => update({ stripeAccountId: e.target.value })}
              placeholder="acct_..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            {connected ? (
              <span className="text-foreground">Connected ({initial.stripeAccountId})</span>
            ) : (
              <span>Not connected — paid meeting types will be blocked.</span>
            )}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice delivery</CardTitle>
          <CardDescription>
            For invoice-method bookings, choose where the invoice is generated and sent. From
            Soul Suite means the app emails the invitee an invoice with a Stripe payment link
            and tracks payment automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceSource">Send invoices</Label>
            <Select
              id="invoiceSource"
              value={draft.invoiceSource}
              onChange={(e) => update({ invoiceSource: e.target.value as InvoiceSource })}
            >
              <option value="EXTERNAL">From another app (you handle invoicing)</option>
              <option value="SOUL_SUITE" disabled={!draft.stripeAccountId.trim()}>
                From Soul Suite (auto-generate invoice + payment link)
              </option>
            </Select>
            {!draft.stripeAccountId.trim() && (
              <p className="text-xs text-muted-foreground">
                Connect a Stripe account above to enable Soul Suite invoice delivery.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adyen merchant account</CardTitle>
          <CardDescription>
            For meeting types that collect payment via Adyen Pay-by-Link. Soul Suite operates the
            Adyen platform; paste the sub-merchant account name we provisioned for you (e.g.
            <code className="px-1">SoulSuiteHostName</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adyenMerchantAccount">Merchant account</Label>
            <Input
              id="adyenMerchantAccount"
              value={draft.adyenMerchantAccount}
              onChange={(e) => update({ adyenMerchantAccount: e.target.value })}
              placeholder="SoulSuiteHostName"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            {initial.adyenMerchantAccount ? (
              <span className="text-foreground">
                Connected ({initial.adyenMerchantAccount})
              </span>
            ) : (
              <span>Not connected — Adyen-paid meeting types will be blocked.</span>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
