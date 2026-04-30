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
}

function brandFrame(title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0c0a09">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">${escapeHtml(title)}</h1>
    ${body}
    <hr style="border:none;border-top:1px solid #e7e5e4;margin:32px 0" />
    <p style="font-size:12px;color:#a8a29e;margin:0">Sent by Soul Suite</p>
  </div>
</body></html>`;
}

export function bookingConfirmationTemplate(b: BookingTemplateInput): { html: string; text: string; subject: string } {
  const when = formatDateRange(b.startsAtIso, b.endsAtIso);
  const subject = `Confirmed: ${b.meetingTypeName} with ${b.hostName} — ${when}`;
  const html = brandFrame(
    "You're booked",
    `<p>Hi ${escapeHtml(b.inviteeName)},</p>
    <p>Your meeting with <strong>${escapeHtml(b.hostName)}</strong> is confirmed.</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:4px 0;color:#57534e">When</td><td style="padding:4px 0 4px 24px">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:4px 0;color:#57534e">What</td><td style="padding:4px 0 4px 24px">${escapeHtml(b.meetingTypeName)}</td></tr>
      ${b.meetUrl ? `<tr><td style="padding:4px 0;color:#57534e">Join</td><td style="padding:4px 0 4px 24px"><a href="${escapeAttr(b.meetUrl)}">${escapeHtml(b.meetUrl)}</a></td></tr>` : ""}
    </table>
    <p>Need to change something?</p>
    <p>
      <a href="${escapeAttr(b.rescheduleUrl)}" style="display:inline-block;padding:8px 14px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none;margin-right:8px">Reschedule</a>
      <a href="${escapeAttr(b.cancelUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Cancel</a>
    </p>`,
  );
  const text =
    `You're booked: ${b.meetingTypeName} with ${b.hostName}\n\n` +
    `When: ${when}\n` +
    (b.meetUrl ? `Join: ${b.meetUrl}\n` : "") +
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
    <p>Need to change again?</p>
    <p>
      <a href="${escapeAttr(b.rescheduleUrl)}" style="display:inline-block;padding:8px 14px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none;margin-right:8px">Reschedule</a>
      <a href="${escapeAttr(b.cancelUrl)}" style="display:inline-block;padding:8px 14px;border:1px solid #e7e5e4;color:#0c0a09;border-radius:6px;text-decoration:none">Cancel</a>
    </p>`,
  );
  const text =
    `Rescheduled to ${when}\n` +
    (b.meetUrl ? `Join: ${b.meetUrl}\n` : "") +
    `\nReschedule again: ${b.rescheduleUrl}\nCancel: ${b.cancelUrl}\n`;
  return { html, text, subject };
}

export function pollInviteTemplate(args: {
  ownerName: string;
  pollName: string;
  durationMinutes: number;
  voteUrl: string;
  recipientEmail: string;
}): { html: string; text: string; subject: string } {
  const subject = `${args.ownerName} wants to find a time: ${args.pollName}`;
  const html = brandFrame(
    "Pick a time that works",
    `<p>${escapeHtml(args.ownerName)} is proposing a <strong>${args.durationMinutes}-minute</strong> meeting and would like to know what works for you.</p>
    <p style="margin-top:20px">
      <a href="${escapeAttr(args.voteUrl)}" style="display:inline-block;padding:10px 18px;background:#1c1917;color:#fafafa;border-radius:6px;text-decoration:none">Vote on times</a>
    </p>
    <p style="font-size:12px;color:#a8a29e;margin-top:16px">This link is unique to ${escapeHtml(args.recipientEmail)} — keep it private.</p>`,
  );
  const text = `${args.ownerName} wants to find a time for "${args.pollName}" (${args.durationMinutes} min).\n\nVote here: ${args.voteUrl}\n`;
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
