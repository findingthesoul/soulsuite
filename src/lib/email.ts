import { Resend } from "resend";
import { serverEnv, publicEnv } from "@/lib/env";

// Email-sending wrapper. When RESEND_API_KEY isn't set we log instead of sending — keeps dev
// painless and means production is just "add the key and a verified sender". Failures here
// never throw out of the calling API route: email is a side-effect, not a blocker for the
// booking/cancellation/etc operation.

let _resend: Resend | null = null;
function client(): Resend | null {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  // When set, the From header reads `${fromName} via Soul Suite <EMAIL_FROM>` so the recipient
  // sees the organising user's name. The technical sender stays on the verified domain.
  fromName?: string;
  // Replies route here — typically the organising host's email so they hear back directly.
  replyTo?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; reason?: string }> {
  const env = serverEnv();
  const c = client();
  const recipients = Array.isArray(args.to) ? args.to : [args.to];

  if (!c || !env.EMAIL_FROM) {
    // Dev / unconfigured: log so you can eyeball the output during local testing.
    console.log("[email] (skipped — no Resend key/from)", {
      to: recipients,
      subject: args.subject,
    });
    return { ok: false, reason: "not configured" };
  }

  // Construct From header: `${name} via Soul Suite <verified@domain>` when a name is given.
  const from = args.fromName
    ? `${stripDisplayName(args.fromName)} via Soul Suite <${env.EMAIL_FROM}>`
    : env.EMAIL_FROM;

  try {
    const result = await c.emails.send({
      from,
      to: recipients,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
    });
    if (result.error) {
      console.error("[email] resend error", result.error);
      return { ok: false, reason: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed", err);
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

// ────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────

interface BookingTemplateInput {
  hostName: string;
  meetingTypeName: string;
  startsAtIso: string;
  endsAtIso: string;
  inviteeName: string;
  inviteeEmail: string;
  cancelUrl: string;
  rescheduleUrl: string;
  meetUrl?: string | null;
  // Optional label for the join link (e.g. "Personal room"). Defaults to "Join" when empty so
  // existing Zoom / Meet emails are unaffected.
  meetUrlLabel?: string | null;
  // Physical location string. When set this is rendered in place of the meet/zoom join section
  // (e.g. for IN_PERSON meetings) or alongside it (when an alternativeLocation override added a
  // venue to a Zoom booking — both lines are useful then).
  location?: string | null;
  // Public URL serving an .ics file for this booking. Linked from the email so invitees on
  // Apple/Outlook/etc. can add the meeting to their calendar in one click.
  icalUrl?: string | null;
  // Workspace logo URL (https://...) — rendered at the top on a forced white background so
  // it stays legible in dark-mode email clients.
  logoUrl?: string | null;
  // Invoice-payment heads-up. Rendered as an extra block on the confirmation email so the
  // invitee knows an invoice will follow from the host (rather than nothing showing up).
  invoice?: {
    billingEmail: string;
    companyName: string;
    reference?: string | null;
  } | null;
}

function brandFrame(title: string, body: string, logoUrl?: string | null): string {
  // Force white background everywhere so the logo always sits on white regardless of the
  // recipient's dark-mode email client. Use bgcolor attr (older Outlook) + inline CSS.
  const logoBlock = logoUrl
    ? `<div style="text-align:center;padding:0 0 24px"><img src="${escapeAttr(logoUrl)}" alt="" height="32" style="height:32px;display:inline-block;border:0;outline:none"></div>`
    : "";
  return `<!doctype html>
<html><body bgcolor="#ffffff" style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0c0a09">
  <table width="100%" bgcolor="#ffffff" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;color:#0c0a09">
      ${logoBlock}
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">${escapeHtml(title)}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:32px 0" />
      <p style="font-size:12px;color:#a8a29e;margin:0">
        Sent by Soul Suite ·
        <a href="${escapeAttr(`${publicEnv.NEXT_PUBLIC_APP_URL}/privacy`)}" style="color:#a8a29e">Privacy</a> ·
        <a href="${escapeAttr(`${publicEnv.NEXT_PUBLIC_APP_URL}/terms`)}" style="color:#a8a29e">Terms</a>
      </p>
    </div>
  </td></tr></table>
</body></html>`;
}

export function bookingConfirmationTemplate(b: BookingTemplateInput): { html: string; text: string; subject: string } {
  const when = formatDateRange(b.startsAtIso, b.endsAtIso);
  const subject = `Confirmed: ${b.meetingTypeName} with ${b.hostName} — ${when}`;
  const invoiceBlockHtml = b.invoice
    ? `<div style="margin:20px 0;padding:14px 16px;border:1px solid #e7e5e4;border-radius:8px;background:#fafaf9">
        <p style="margin:0 0 4px;font-size:13px;color:#57534e">Payment</p>
        <p style="margin:0;font-size:14px">An invoice will be sent to <strong>${escapeHtml(
          b.invoice.billingEmail,
        )}</strong> at <strong>${escapeHtml(b.invoice.companyName)}</strong>${
          b.invoice.reference ? ` (Reference: ${escapeHtml(b.invoice.reference)})` : ""
        }.</p>
        <p style="margin:6px 0 0;font-size:12px;color:#a8a29e">Look out for an email from ${escapeHtml(
          b.hostName,
        )}.</p>
      </div>`
    : "";
  const html = brandFrame(
    "You're booked",
    /* body */ `<p>Hi ${escapeHtml(b.inviteeName)},</p>
    <p>Your meeting with <strong>${escapeHtml(b.hostName)}</strong> is confirmed.</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:4px 0;color:#57534e">When</td><td style="padding:4px 0 4px 24px">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:4px 0;color:#57534e">What</td><td style="padding:4px 0 4px 24px">${escapeHtml(b.meetingTypeName)}</td></tr>
      ${b.location ? `<tr><td style="padding:4px 0;color:#57534e">Location</td><td style="padding:4px 0 4px 24px">${escapeHtml(b.location)}</td></tr>` : ""}
      ${b.meetUrl ? `<tr><td style="padding:4px 0;color:#57534e">${escapeHtml(b.meetUrlLabel || "Join")}</td><td style="padding:4px 0 4px 24px"><a href="${escapeAttr(b.meetUrl)}">${escapeHtml(b.meetUrl)}</a></td></tr>` : ""}
    </table>
    ${invoiceBlockHtml}
    ${b.icalUrl ? `<p style="margin-top:12px"><a href="${escapeAttr(b.icalUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Add to calendar (.ics)</a></p>` : ""}
    <p>Need to change something?</p>
    <p>
      <a href="${escapeAttr(b.rescheduleUrl)}" style="display:inline-block;padding:8px 14px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none;margin-right:8px">Reschedule</a>
      <a href="${escapeAttr(b.cancelUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Cancel</a>
    </p>`,
    b.logoUrl,
  );
  const text =
    `You're booked: ${b.meetingTypeName} with ${b.hostName}\n\n` +
    `When: ${when}\n` +
    (b.location ? `Location: ${b.location}\n` : "") +
    (b.meetUrl ? `${b.meetUrlLabel || "Join"}: ${b.meetUrl}\n` : "") +
    (b.invoice
      ? `\nPayment: An invoice will be sent to ${b.invoice.billingEmail} at ${b.invoice.companyName}.${
          b.invoice.reference ? ` Reference: ${b.invoice.reference}.` : ""
        }\n`
      : "") +
    (b.icalUrl ? `Add to calendar: ${b.icalUrl}\n` : "") +
    `\nReschedule: ${b.rescheduleUrl}\nCancel: ${b.cancelUrl}\n`;
  return { html, text, subject };
}

export function bookingCancellationTemplate(b: BookingTemplateInput): { html: string; text: string; subject: string } {
  const when = formatDateRange(b.startsAtIso, b.endsAtIso);
  const subject = `Cancelled: ${b.meetingTypeName} — ${when}`;
  const html = brandFrame(
    "Booking cancelled",
    `<p>Hi ${escapeHtml(b.inviteeName)},</p>
    <p>Your meeting with <strong>${escapeHtml(b.hostName)}</strong> on <strong>${escapeHtml(when)}</strong> has been cancelled.</p>`,
    b.logoUrl,
  );
  const text = `Cancelled: ${b.meetingTypeName} with ${b.hostName} — ${when}\n`;
  return { html, text, subject };
}

export function bookingRescheduleTemplate(b: BookingTemplateInput): { html: string; text: string; subject: string } {
  const when = formatDateRange(b.startsAtIso, b.endsAtIso);
  const subject = `Rescheduled: ${b.meetingTypeName} — ${when}`;
  const html = brandFrame(
    "Meeting rescheduled",
    `<p>Hi ${escapeHtml(b.inviteeName)},</p>
    <p>Your meeting with <strong>${escapeHtml(b.hostName)}</strong> has been moved to <strong>${escapeHtml(when)}</strong>.</p>
    ${b.meetUrl ? `<p>Join link: <a href="${escapeAttr(b.meetUrl)}">${escapeHtml(b.meetUrl)}</a></p>` : ""}
    ${b.icalUrl ? `<p style="margin-top:12px"><a href="${escapeAttr(b.icalUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Add updated time to calendar (.ics)</a></p>` : ""}
    <p>Need to change again?</p>
    <p>
      <a href="${escapeAttr(b.rescheduleUrl)}" style="display:inline-block;padding:8px 14px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none;margin-right:8px">Reschedule</a>
      <a href="${escapeAttr(b.cancelUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Cancel</a>
    </p>`,
    b.logoUrl,
  );
  const text =
    `Rescheduled to ${when}\n` +
    (b.meetUrl ? `Join: ${b.meetUrl}\n` : "") +
    (b.icalUrl ? `Add to calendar: ${b.icalUrl}\n` : "") +
    `\nReschedule again: ${b.rescheduleUrl}\nCancel: ${b.cancelUrl}\n`;
  return { html, text, subject };
}

// Brief notification email when the host changes a booking's alternative location.
// Replies route to the host so the invitee can hit reply with questions.
export function bookingLocationUpdateTemplate(args: {
  hostName: string;
  meetingTypeName: string;
  startsAtIso: string;
  endsAtIso: string;
  inviteeName: string;
  newLocation: string;
  meetUrl?: string | null;
  logoUrl?: string | null;
}): { html: string; text: string; subject: string } {
  const when = formatDateRange(args.startsAtIso, args.endsAtIso);
  const subject = `Location updated: ${args.meetingTypeName} — ${when}`;
  const html = brandFrame(
    "Location updated",
    `<p>Hi ${escapeHtml(args.inviteeName)},</p>
    <p>The location for your meeting with <strong>${escapeHtml(args.hostName)}</strong> on <strong>${escapeHtml(when)}</strong> has changed:</p>
    <p style="margin:16px 0;padding:12px 14px;border:1px solid #e7e5e4;border-radius:8px;background:#fafaf9"><strong>${escapeHtml(args.newLocation)}</strong></p>
    ${args.meetUrl ? `<p style="font-size:13px;color:#57534e">Your existing join link still works: <a href="${escapeAttr(args.meetUrl)}">${escapeHtml(args.meetUrl)}</a></p>` : ""}`,
    args.logoUrl,
  );
  const text =
    `Location updated for ${args.meetingTypeName} with ${args.hostName} (${when}):\n` +
    `${args.newLocation}\n` +
    (args.meetUrl ? `\nJoin link still works: ${args.meetUrl}\n` : "");
  return { html, text, subject };
}

export function pollInviteTemplate(args: {
  ownerName: string;
  pollName: string;
  durationMinutes: number;
  voteUrl: string;
  recipientEmail: string;
  logoUrl?: string | null;
}): { html: string; text: string; subject: string } {
  const subject = `${args.ownerName} wants to find a time: ${args.pollName}`;
  const html = brandFrame(
    "Pick a time that works",
    `<p>${escapeHtml(args.ownerName)} is proposing a <strong>${args.durationMinutes}-minute</strong> meeting and would like to know what works for you.</p>
    <p style="margin-top:20px">
      <a href="${escapeAttr(args.voteUrl)}" style="display:inline-block;padding:10px 18px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none">Vote on times</a>
    </p>
    <p style="font-size:12px;color:#a8a29e;margin-top:16px">This link is unique to ${escapeHtml(args.recipientEmail)} — keep it private.</p>`,
    args.logoUrl,
  );
  const text = `${args.ownerName} wants to find a time for "${args.pollName}" (${args.durationMinutes} min).\n\nVote here: ${args.voteUrl}\n`;
  return { html, text, subject };
}

// Workspace member invite — sent when an OWNER/ADMIN adds someone to the workspace.
// Project invite re-uses the same template with a different scope label.
export function memberInviteTemplate(args: {
  inviterName: string;
  workspaceName: string;
  scopeLabel: string; // e.g. "the Soul workspace" or "the EBBF Athens project"
  acceptUrl: string;
  recipientEmail: string;
  expiresAt: Date;
}): { html: string; text: string; subject: string } {
  const subject = `${args.inviterName} invited you to ${args.scopeLabel} on ${args.workspaceName}`;
  const expiresStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(args.expiresAt);
  const html = brandFrame(
    "You've been invited",
    `<p>${escapeHtml(args.inviterName)} has invited you to <strong>${escapeHtml(args.scopeLabel)}</strong> on Soul Suite.</p>
    <p style="margin-top:20px">
      <a href="${escapeAttr(args.acceptUrl)}" style="display:inline-block;padding:10px 18px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none">Accept invite</a>
    </p>
    <p style="font-size:12px;color:#a8a29e;margin-top:16px">This link is for ${escapeHtml(args.recipientEmail)} and expires on ${escapeHtml(expiresStr)}.</p>`,
  );
  const text =
    `${args.inviterName} invited you to ${args.scopeLabel} on Soul Suite.\n\n` +
    `Accept here: ${args.acceptUrl}\n\n` +
    `Link expires on ${expiresStr}.\n`;
  return { html, text, subject };
}

// Invoice email — sent when host.invoiceSource = SOUL_SUITE. Carries the Stripe payment link
// and renders the invitee's billing block + a single line item. Replies route to the host so
// the invitee can ask billing questions directly (handled by the caller via replyTo).
export function invoiceEmailTemplate(args: {
  hostName: string;
  workspaceName: string;
  invoiceNumber: string;
  issuedAt: Date;
  meetingTypeName: string;
  startsAtIso: string;
  endsAtIso: string;
  inviteeName: string;
  priceCents: number;
  currency: string;
  formattedPrice: string;
  paymentLinkUrl: string;
  billing: {
    companyName: string;
    billingEmail: string;
    addressLine1: string;
    addressLine2?: string;
    postalCode: string;
    city: string;
    countryLabel: string;
    vatId?: string;
    reference?: string;
  };
  logoUrl?: string | null;
}): { html: string; text: string; subject: string } {
  const when = formatDateRange(args.startsAtIso, args.endsAtIso);
  const subject = `Invoice ${args.invoiceNumber} — ${args.meetingTypeName}`;
  const issuedStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(args.issuedAt);

  const billingLines = [
    args.billing.companyName,
    args.billing.addressLine1,
    args.billing.addressLine2,
    `${args.billing.postalCode} ${args.billing.city}`,
    args.billing.countryLabel,
    args.billing.vatId ? `VAT: ${args.billing.vatId}` : "",
    args.billing.reference ? `Reference: ${args.billing.reference}` : "",
  ].filter(Boolean) as string[];

  const billingHtml = billingLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("");

  const html = brandFrame(
    `Invoice ${args.invoiceNumber}`,
    `<p>Hi ${escapeHtml(args.inviteeName)},</p>
    <p>Here is invoice <strong>${escapeHtml(args.invoiceNumber)}</strong> for your meeting with <strong>${escapeHtml(args.hostName)}</strong>. Use the button below to pay securely via Stripe.</p>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:20px 0;font-size:13px;color:#0c0a09">
      <tr>
        <td valign="top" style="padding-right:16px;width:50%">
          <div style="color:#a8a29e;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">From</div>
          <div><strong>${escapeHtml(args.hostName)}</strong></div>
          <div>${escapeHtml(args.workspaceName)}</div>
        </td>
        <td valign="top" style="padding-left:16px;width:50%">
          <div style="color:#a8a29e;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Bill to</div>
          ${billingHtml}
        </td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 0;font-size:13px;color:#57534e">
      <tr>
        <td>Invoice number</td><td align="right" style="color:#0c0a09">${escapeHtml(args.invoiceNumber)}</td>
      </tr>
      <tr>
        <td>Issued</td><td align="right" style="color:#0c0a09">${escapeHtml(issuedStr)}</td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:20px 0;border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e7e5e4;color:#57534e;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">Description</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #e7e5e4;color:#57534e;font-size:12px;text-transform:uppercase;letter-spacing:0.04em">Amount</td>
      </tr>
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e7e5e4">
          <div><strong>${escapeHtml(args.meetingTypeName)}</strong></div>
          <div style="color:#57534e;font-size:13px">${escapeHtml(when)}</div>
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #e7e5e4">${escapeHtml(args.formattedPrice)}</td>
      </tr>
      <tr>
        <td style="padding:12px 0"><strong>Total</strong></td>
        <td align="right" style="padding:12px 0;font-size:16px"><strong>${escapeHtml(args.formattedPrice)}</strong></td>
      </tr>
    </table>

    <p style="margin:24px 0">
      <a href="${escapeAttr(args.paymentLinkUrl)}" style="display:inline-block;padding:12px 22px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none;font-weight:600">Pay invoice</a>
    </p>
    <p style="font-size:12px;color:#a8a29e">Or paste this link into your browser: ${escapeHtml(args.paymentLinkUrl)}</p>`,
    args.logoUrl,
  );
  const text =
    `Invoice ${args.invoiceNumber}\n` +
    `Issued: ${issuedStr}\n\n` +
    `From: ${args.hostName} (${args.workspaceName})\n\n` +
    `Bill to:\n${billingLines.join("\n")}\n\n` +
    `${args.meetingTypeName}\n${when}\n` +
    `Total: ${args.formattedPrice}\n\n` +
    `Pay here: ${args.paymentLinkUrl}\n`;
  return { html, text, subject };
}

// Invoice-voided notification — sent to the billing email when the host issues a credit note
// for a cancelled booking. Tells the invitee to disregard the original invoice + (for SOUL_SUITE
// invoices) confirms the payment link no longer works.
export function invoiceVoidedTemplate(args: {
  hostName: string;
  workspaceName: string;
  invoiceNumber: string | null;
  meetingTypeName: string;
  startsAtIso: string;
  endsAtIso: string;
  inviteeName: string;
  formattedPrice: string;
  paymentLinkDeactivated: boolean;
  billingEmail: string;
  logoUrl?: string | null;
}): { html: string; text: string; subject: string } {
  const when = formatDateRange(args.startsAtIso, args.endsAtIso);
  const subjectLead = args.invoiceNumber
    ? `Invoice ${args.invoiceNumber} cancelled`
    : "Invoice cancelled";
  const subject = `${subjectLead} — ${args.meetingTypeName}`;
  const linkLine = args.paymentLinkDeactivated
    ? "<p>The payment link from the original invoice has been deactivated.</p>"
    : "";
  const html = brandFrame(
    subjectLead,
    `<p>Hi ${escapeHtml(args.inviteeName)},</p>
    <p>The booking for <strong>${escapeHtml(args.meetingTypeName)}</strong> on <strong>${escapeHtml(when)}</strong> with ${escapeHtml(args.hostName)} has been cancelled, and ${args.invoiceNumber ? `invoice <strong>${escapeHtml(args.invoiceNumber)}</strong>` : "the corresponding invoice"} (${escapeHtml(args.formattedPrice)}) is no longer due.</p>
    ${linkLine}
    <p style="font-size:12px;color:#a8a29e;margin-top:16px">If you've already initiated payment, please reply to this email so ${escapeHtml(args.hostName)} can sort it out with you.</p>`,
    args.logoUrl,
  );
  const text =
    `${subjectLead}\n\n` +
    `The booking for ${args.meetingTypeName} on ${when} with ${args.hostName} has been cancelled.\n` +
    `${args.invoiceNumber ? `Invoice ${args.invoiceNumber} ` : "The invoice "}(${args.formattedPrice}) is no longer due.\n` +
    (args.paymentLinkDeactivated ? `The payment link from the original invoice has been deactivated.\n` : "") +
    `\nIf you've already initiated payment, please reply to this email.\n`;
  return { html, text, subject };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

export function appUrl(path: string): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)} (UTC)`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Strip characters that would break the From header. Quotes/angle-brackets become spaces;
// trims whitespace runs. Defends against names like `Foo <evil@x>` slipping into the header.
function stripDisplayName(name: string): string {
  return name.replace(/[<>"\\]/g, " ").replace(/\s+/g, " ").trim();
}
