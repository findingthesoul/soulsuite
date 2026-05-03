"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog";

interface Row {
  id: string;
  startsAt: string;
  endsAt: string;
  inviteeEmail: string;
  inviteeName: string;
  meetingTypeName: string;
  hostName: string;
  priceLabel: string;
  paymentStatus:
    | "PAID"
    | "REFUNDED"
    | "FAILED"
    | "NOT_REQUIRED"
    | "PENDING"
    | "INVOICE_PENDING"
    | "INVOICE_SENT";
  paymentMethod: "STRIPE" | "INVOICE";
  status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED";
  detailHref: string;
  isFailedToFinalize: boolean;
  hasPaymentIntent: boolean;
  isInvoicePending: boolean;
  isInvoiceSent: boolean;
}

export function PaymentRow({ row, variant = "table" }: { row: Row; variant?: "table" | "card" }) {
  const router = useRouter();
  const [retryOpen, setRetryOpen] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [invoicedOpen, setInvoicedOpen] = React.useState(false);
  const [paidOpen, setPaidOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function postJson(path: string): Promise<{ ok: boolean; message?: string }> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json.error || `Request failed (${res.status})`;
        setError(message);
        return { ok: false, message };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  }

  async function doMarkInvoiced() {
    const r = await postJson(`/api/admin/bookings/${row.id}/mark-invoiced`);
    if (r.ok) {
      setInvoicedOpen(false);
      router.refresh();
    }
  }

  async function doMarkPaid() {
    const r = await postJson(`/api/admin/bookings/${row.id}/mark-paid`);
    if (r.ok) {
      setPaidOpen(false);
      router.refresh();
    }
  }

  async function doRetry() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${row.id}/retry-finalize`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Retry failed (${res.status})`);
        return;
      }
      setRetryOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPending(false);
    }
  }

  async function doRefund() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${row.id}/refund`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Refund failed (${res.status})`);
        return;
      }
      setRefundOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPending(false);
    }
  }

  const actions = (
    <>
      {row.isFailedToFinalize && (
        <>
          <Button size="sm" variant="primary" onClick={() => setRetryOpen(true)}>
            Retry
          </Button>
          {row.hasPaymentIntent && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefundOpen(true)}
              className="text-destructive hover:bg-destructive/10"
            >
              Refund
            </Button>
          )}
        </>
      )}
      {row.isInvoicePending && (
        <>
          <Button size="sm" variant="primary" onClick={() => setInvoicedOpen(true)}>
            Mark as invoiced
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPaidOpen(true)}>
            Mark as paid
          </Button>
        </>
      )}
      {row.isInvoiceSent && (
        <Button size="sm" variant="primary" onClick={() => setPaidOpen(true)}>
          Mark as paid
        </Button>
      )}
      <Link
        href={row.detailHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="View invitee confirmation page"
      >
        <ExternalLink className="h-3 w-3" />
        View
      </Link>
    </>
  );

  // Dialogs are positioned: fixed by the Dialog primitive, so they render fine
  // whether they sit inside a <td> (table) or a <div> (card). Sharing one set
  // across both layouts avoids duplicating four modals per row.
  const dialogs = (
    <>
      <Dialog open={retryOpen} onOpenChange={(o) => !pending && setRetryOpen(o)}>
        <DialogHeader
          title="Retry finalisation?"
          description="This will create the meeting + send a fresh confirmation email to the invitee."
          onClose={() => !pending && setRetryOpen(false)}
        />
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{row.inviteeName}</span> ·{" "}
            {row.meetingTypeName} · {formatDate(row.startsAt)}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setRetryOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doRetry} disabled={pending}>
            {pending ? "Retrying…" : "Retry finalisation"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={invoicedOpen} onOpenChange={(o) => !pending && setInvoicedOpen(o)}>
        <DialogHeader
          title="Mark this booking as invoiced?"
          description="This is a tracking-only flag — actually sending the invoice happens in your invoicing tool."
          onClose={() => !pending && setInvoicedOpen(false)}
        />
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{row.inviteeName}</span> ·{" "}
            {row.meetingTypeName} · {formatDate(row.startsAt)}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setInvoicedOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doMarkInvoiced} disabled={pending}>
            {pending ? "Saving…" : "Mark as invoiced"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={paidOpen} onOpenChange={(o) => !pending && setPaidOpen(o)}>
        <DialogHeader
          title="Mark this booking as paid?"
          description="Use after the invoice has actually been paid externally. No money moves in our system — this just updates the tracking flag."
          onClose={() => !pending && setPaidOpen(false)}
        />
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{row.inviteeName}</span> ·{" "}
            {row.meetingTypeName} · {formatDate(row.startsAt)} · {row.priceLabel}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setPaidOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doMarkPaid} disabled={pending}>
            {pending ? "Saving…" : "Mark as paid"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={(o) => !pending && setRefundOpen(o)}>
        <DialogHeader
          title={`Refund ${row.priceLabel} to ${row.inviteeEmail}?`}
          description="This cannot be undone. The booking will be marked refunded + cancelled."
          onClose={() => !pending && setRefundOpen(false)}
        />
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{row.inviteeName}</span> ·{" "}
            {row.meetingTypeName} · {formatDate(row.startsAt)}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setRefundOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={doRefund} disabled={pending}>
            {pending ? "Refunding…" : "Refund"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );

  if (variant === "card") {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{row.inviteeName}</p>
            <p className="text-xs text-muted-foreground truncate">{row.inviteeEmail}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <PaymentPill status={row.paymentStatus} />
            <BookingPill status={row.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
          <div>
            <p className="text-subtle-foreground uppercase tracking-wide">Date</p>
            <p className="text-foreground">{formatDate(row.startsAt)}</p>
            <p className="text-muted-foreground">{formatTimeRange(row.startsAt, row.endsAt)}</p>
          </div>
          <div>
            <p className="text-subtle-foreground uppercase tracking-wide">Amount</p>
            <p className="text-foreground">{row.priceLabel}</p>
          </div>
          <div className="col-span-2">
            <p className="text-subtle-foreground uppercase tracking-wide">Meeting type</p>
            <p className="text-foreground">{row.meetingTypeName}</p>
            <p className="text-muted-foreground">with {row.hostName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">{actions}</div>
        {dialogs}
      </div>
    );
  }

  return (
    <tr className="hover:bg-surface-muted/40">
      <td className="px-4 py-3 align-top">
        <div className="text-foreground">{formatDate(row.startsAt)}</div>
        <div className="text-xs text-muted-foreground">{formatTimeRange(row.startsAt, row.endsAt)}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="text-foreground">{row.inviteeName}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[20ch]">{row.inviteeEmail}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="text-foreground">{row.meetingTypeName}</div>
        <div className="text-xs text-muted-foreground">with {row.hostName}</div>
      </td>
      <td className="px-4 py-3 align-top text-foreground">{row.priceLabel}</td>
      <td className="px-4 py-3 align-top">
        <PaymentPill status={row.paymentStatus} />
      </td>
      <td className="px-4 py-3 align-top">
        <BookingPill status={row.status} />
      </td>
      <td className="px-4 py-3 align-top text-right">
        <div className="inline-flex items-center gap-1.5">{actions}</div>
        {dialogs}
      </td>
    </tr>
  );
}

PaymentRow.displayName = "PaymentRow";

function PaymentPill({ status }: { status: Row["paymentStatus"] }) {
  const styles =
    status === "PAID"
      ? "bg-foreground text-background"
      : status === "REFUNDED"
        ? "bg-surface-muted text-foreground"
        : status === "FAILED"
          ? "bg-destructive/10 text-destructive"
          : status === "INVOICE_PENDING" || status === "INVOICE_SENT"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-surface-muted text-muted-foreground";
  // Spaces read better than underscores for the new compound statuses.
  const label = status.toLowerCase().replace(/_/g, " ");
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium inline-block ${styles}`}>
      {label}
    </span>
  );
}

function BookingPill({ status }: { status: Row["status"] }) {
  const styles =
    status === "CANCELLED"
      ? "bg-destructive/10 text-destructive"
      : status === "RESCHEDULED"
        ? "bg-surface-muted text-foreground"
        : "bg-foreground text-background";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${styles}`}>
      {status.toLowerCase()}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${fmt.format(new Date(startIso))} – ${fmt.format(new Date(endIso))}`;
}
