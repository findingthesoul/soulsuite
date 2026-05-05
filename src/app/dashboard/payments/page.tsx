// Admin payments page: lists paid/refunded/failed bookings for the host(s) the caller can
// manage, with retry + refund actions for the failed-finalize subset. Workspace OWNER/ADMIN
// only. See /api/admin/bookings/[id]/retry-finalize and /refund for the actions.

import { redirect } from "next/navigation";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWorkspaceRole, canManageWorkspace } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/stripe/client";
import { PaymentRow } from "./row";

type Filter = "failed" | "refund-pending" | "credit-pending" | "refunded" | "healthy" | "invoice" | "all";

function parseFilter(value: string | undefined): Filter {
  if (
    value === "refund-pending" ||
    value === "credit-pending" ||
    value === "refunded" ||
    value === "healthy" ||
    value === "invoice" ||
    value === "all"
  )
    return value;
  return "failed";
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await getPageContextOrRedirect();
  const sp = await searchParams;
  const filter = parseFilter(sp.filter);

  const membership = await getWorkspaceRole(ctx.host);
  if (!membership || !canManageWorkspace(membership.role)) {
    redirect("/dashboard");
  }

  // All hosts in this workspace — bookings for any of them are in scope.
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: membership.workspaceId },
    select: { hostId: true },
  });
  const manageableHostIds = members.map((m) => m.hostId);

  const baseWhere: Prisma.BookingWhereInput = {
    hostId: { in: manageableHostIds },
    paymentStatus: {
      in: [
        "PAID",
        "REFUNDED",
        "FAILED",
        "INVOICE_PENDING",
        "INVOICE_SENT",
        "INVOICE_VOIDED",
      ],
    },
  };

  // Distinguishing the cancelled-and-paid cases:
  //   • failed         — paid but never finalized (no Google event). Needs Retry + maybe Refund.
  //   • refund-pending — paid AND finalized AND later cancelled. Needs Refund only.
  //   • credit-pending — invoice booking cancelled before money was collected. Needs Credit.
  const filterWhere: Prisma.BookingWhereInput =
    filter === "failed"
      ? {
          ...baseWhere,
          paymentStatus: "PAID",
          status: "CANCELLED",
          googleEventId: null,
        }
      : filter === "refund-pending"
        ? {
            ...baseWhere,
            paymentStatus: "PAID",
            status: "CANCELLED",
            googleEventId: { not: null },
          }
        : filter === "credit-pending"
          ? {
              ...baseWhere,
              paymentMethod: "INVOICE",
              paymentStatus: { in: ["INVOICE_PENDING", "INVOICE_SENT"] },
              status: "CANCELLED",
            }
          : filter === "refunded"
            ? { ...baseWhere, paymentStatus: { in: ["REFUNDED", "INVOICE_VOIDED"] } }
            : filter === "healthy"
              ? { ...baseWhere, paymentStatus: "PAID", status: "CONFIRMED" }
              : filter === "invoice"
                ? {
                    ...baseWhere,
                    paymentMethod: "INVOICE",
                    paymentStatus: { in: ["INVOICE_PENDING", "INVOICE_SENT"] },
                    status: { not: "CANCELLED" },
                  }
                : baseWhere;

  const [bookings, counts] = await Promise.all([
    prisma.booking.findMany({
      where: filterWhere,
      orderBy: { startsAt: "desc" },
      take: 200,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        inviteeEmail: true,
        inviteeName: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        stripePaymentIntent: true,
        googleEventId: true,
        hostId: true,
        invoicePaymentLinkUrl: true,
        invoiceNumber: true,
        host: { select: { slug: true, name: true, invoiceSource: true } },
        meetingType: {
          select: {
            slug: true,
            name: true,
            priceCents: true,
            priceCurrency: true,
            scope: true,
            project: { select: { slug: true } },
          },
        },
      },
    }),
    Promise.all([
      prisma.booking.count({
        where: {
          ...baseWhere,
          paymentStatus: "PAID",
          status: "CANCELLED",
          googleEventId: null,
        },
      }),
      prisma.booking.count({
        where: {
          ...baseWhere,
          paymentStatus: "PAID",
          status: "CANCELLED",
          googleEventId: { not: null },
        },
      }),
      prisma.booking.count({
        where: {
          ...baseWhere,
          paymentMethod: "INVOICE",
          paymentStatus: { in: ["INVOICE_PENDING", "INVOICE_SENT"] },
          status: "CANCELLED",
        },
      }),
      prisma.booking.count({
        where: { ...baseWhere, paymentStatus: { in: ["REFUNDED", "INVOICE_VOIDED"] } },
      }),
      prisma.booking.count({
        where: { ...baseWhere, paymentStatus: "PAID", status: "CONFIRMED" },
      }),
      prisma.booking.count({
        where: {
          ...baseWhere,
          paymentMethod: "INVOICE",
          paymentStatus: { in: ["INVOICE_PENDING", "INVOICE_SENT"] },
          status: { not: "CANCELLED" },
        },
      }),
      prisma.booking.count({ where: baseWhere }),
    ]),
  ]);

  const [
    failedCount,
    refundPendingCount,
    creditPendingCount,
    refundedCount,
    healthyCount,
    invoiceCount,
    allCount,
  ] = counts;

  const rows = bookings.map((b) => {
    const slugForUrl =
      b.meetingType.scope === "PROJECT"
        ? b.meetingType.project?.slug ?? b.host.slug
        : b.host.slug;
    const detailHref = `/${slugForUrl}/${b.meetingType.slug}/confirmed/${b.id}`;
    const priceLabel =
      b.meetingType.priceCents != null && b.meetingType.priceCurrency
        ? formatPrice(b.meetingType.priceCents, b.meetingType.priceCurrency)
        : "—";
    return {
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      inviteeEmail: b.inviteeEmail,
      inviteeName: b.inviteeName,
      meetingTypeName: b.meetingType.name,
      hostName: b.host.name,
      priceLabel,
      paymentStatus: b.paymentStatus,
      paymentMethod: b.paymentMethod,
      status: b.status,
      detailHref,
      isFailedToFinalize:
        b.paymentStatus === "PAID" && b.status === "CANCELLED" && !b.googleEventId,
      hasPaymentIntent: !!b.stripePaymentIntent,
      isInvoicePending:
        b.paymentMethod === "INVOICE" &&
        b.paymentStatus === "INVOICE_PENDING" &&
        b.status !== "CANCELLED",
      isInvoiceSent:
        b.paymentMethod === "INVOICE" &&
        b.paymentStatus === "INVOICE_SENT" &&
        b.status !== "CANCELLED",
      isSoulSuiteInvoice: b.paymentMethod === "INVOICE" && b.host.invoiceSource === "SOUL_SUITE",
      invoicePaymentLinkUrl: b.invoicePaymentLinkUrl,
      invoiceNumber: b.invoiceNumber,
      isPaidAndCancelled:
        b.paymentStatus === "PAID" && b.status === "CANCELLED",
      isInvoiceCreditable:
        b.paymentMethod === "INVOICE" &&
        b.status === "CANCELLED" &&
        (b.paymentStatus === "INVOICE_PENDING" || b.paymentStatus === "INVOICE_SENT"),
    };
  });

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="space-y-6">
        <header className="flex items-start gap-3">
          <CreditCard className="h-5 w-5 mt-1 text-muted-foreground shrink-0" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
            <p className="text-sm text-muted-foreground">
              Recover paid bookings whose finalize step failed, or issue refunds.
            </p>
          </div>
        </header>

        <Filters
          filter={filter}
          counts={{
            failed: failedCount,
            refundPending: refundPendingCount,
            creditPending: creditPendingCount,
            refunded: refundedCount,
            healthy: healthyCount,
            invoice: invoiceCount,
            all: allCount,
          }}
        />

        {rows.length === 0 ? (
          <Card className="border-dashed">
            <div className="p-10 text-center text-sm text-muted-foreground">
              {filter === "failed"
                ? "No paid bookings are stuck. Nice."
                : filter === "refund-pending"
                  ? "No paid bookings are waiting on a refund."
                  : filter === "credit-pending"
                    ? "No invoices need crediting."
                    : filter === "refunded"
                      ? "No refunds or credits yet."
                      : filter === "healthy"
                        ? "No confirmed paid bookings yet."
                        : filter === "invoice"
                          ? "No invoice bookings waiting for follow-up."
                          : "No paid bookings yet."}
            </div>
          </Card>
        ) : (
          <>
            {/* Desktop: dense table view. Hidden on mobile because seven columns
                won't fit on a 375px screen without horizontal scroll, which the
                PWA shouldn't have. */}
            <Card className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-subtle-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left font-medium px-4 py-2.5">Date</th>
                      <th className="text-left font-medium px-4 py-2.5">Invitee</th>
                      <th className="text-left font-medium px-4 py-2.5">Meeting type</th>
                      <th className="text-left font-medium px-4 py-2.5">Amount</th>
                      <th className="text-left font-medium px-4 py-2.5">Payment</th>
                      <th className="text-left font-medium px-4 py-2.5">Booking</th>
                      <th className="text-right font-medium px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <PaymentRow key={r.id} row={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile: stacked cards, same data, vertical layout. */}
            <div className="md:hidden space-y-2">
              {rows.map((r) => (
                <PaymentRow key={r.id} row={r} variant="card" />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Filters({
  filter,
  counts,
}: {
  filter: Filter;
  counts: {
    failed: number;
    refundPending: number;
    creditPending: number;
    refunded: number;
    healthy: number;
    invoice: number;
    all: number;
  };
}) {
  function pillClass(active: boolean) {
    return [
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      active
        ? "bg-foreground text-background"
        : "border border-border bg-surface text-muted-foreground hover:text-foreground",
    ].join(" ");
  }
  function href(f: Filter) {
    return f === "failed" ? "/dashboard/payments" : `/dashboard/payments?filter=${f}`;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={href("failed")} className={pillClass(filter === "failed")}>
        Failed to finalize ({counts.failed})
      </Link>
      <Link href={href("refund-pending")} className={pillClass(filter === "refund-pending")}>
        Refund pending ({counts.refundPending})
      </Link>
      <Link href={href("credit-pending")} className={pillClass(filter === "credit-pending")}>
        Credit pending ({counts.creditPending})
      </Link>
      <Link href={href("refunded")} className={pillClass(filter === "refunded")}>
        Refunded / credited ({counts.refunded})
      </Link>
      <Link href={href("healthy")} className={pillClass(filter === "healthy")}>
        Healthy ({counts.healthy})
      </Link>
      <Link href={href("invoice")} className={pillClass(filter === "invoice")}>
        Invoice (pending) ({counts.invoice})
      </Link>
      <Link href={href("all")} className={pillClass(filter === "all")}>
        All ({counts.all})
      </Link>
    </div>
  );
}
