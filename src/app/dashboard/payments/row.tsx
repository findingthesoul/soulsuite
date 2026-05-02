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
  paymentStatus: "PAID" | "REFUNDED" | "FAILED" | "NOT_REQUIRED" | "PENDING";
  status: "CONFIRMED" | "CANCELLED" | "RESCHEDULED";
  detailHref: string;
  isFailedToFinalize: boolean;
  hasPaymentIntent: boolean;
}

export function PaymentRow({ row }: { row: Row }) {
  const router = useRouter();
  const [retryOpen, setRetryOpen] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
        <div className="inline-flex items-center gap-1.5">
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
        </div>
        {/* Dialogs use fixed positioning (Dialog primitive renders an overlay covering the
            viewport). They produce no DOM when closed, so co-locating them in this cell is
            safe and keeps state ownership tidy. */}
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
          : "bg-surface-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium inline-block ${styles}`}>
      {status.toLowerCase()}
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
