// Resolve the best timezone to render times in for an email recipient. Priority:
//   1. Contact.timeZone — the directory record (workspace-scoped). Set explicitly on the
//      contact page or learned from a public booking where the invitee picked their tz.
//   2. Host.timezone — when the recipient is a user of Soul Suite (e.g. a teammate
//      Sjoerd just booked: Martijn already has his Europe/Amsterdam tz on his Host row).
//   3. The caller-provided fallback (typically the booking host's tz).
//
// Falls through silently — every step is best-effort. The returned tz is what `formatDateRange`
// uses to render times in templates so each recipient sees their own clock without us having
// to ask them on every email.

import { prisma } from "@/lib/prisma";

interface ResolveArgs {
  email: string;
  workspaceId?: string | null;
  fallback: string;
}

export async function resolveRecipientTimezone({
  email,
  workspaceId,
  fallback,
}: ResolveArgs): Promise<string> {
  const lower = email.trim().toLowerCase();
  if (!lower) return fallback;

  // Contact row takes precedence — it's the workspace-curated source. Workspace-scoped to
  // avoid leaking another tenant's setting onto an email we're sending.
  if (workspaceId) {
    const contact = await prisma.contact.findFirst({
      where: { workspaceId, email: lower },
      select: { timeZone: true },
    });
    if (contact?.timeZone) return contact.timeZone;
  }

  // Host fallback — works across workspaces (the email is globally unique on Host). A
  // teammate's Host.timezone is set during onboarding, so this catches the common case
  // where a host books a colleague.
  const host = await prisma.host.findFirst({
    where: { email: lower },
    select: { timezone: true },
  });
  if (host?.timezone) return host.timezone;

  return fallback;
}

// Batched form for the cron / multi-recipient flows. Returns a Map<email-lowercased, tz>.
// Same priority rules. Emails not found anywhere are simply absent from the map; the caller
// should treat that as "use the fallback".
export async function resolveRecipientTimezones(
  emails: string[],
  workspaceId: string | null | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const lower = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  if (lower.length === 0) return out;

  if (workspaceId) {
    const contacts = await prisma.contact.findMany({
      where: { workspaceId, email: { in: lower } },
      select: { email: true, timeZone: true },
    });
    for (const c of contacts) {
      if (c.timeZone) out.set(c.email.toLowerCase(), c.timeZone);
    }
  }
  const missing = lower.filter((e) => !out.has(e));
  if (missing.length > 0) {
    const hosts = await prisma.host.findMany({
      where: { email: { in: missing } },
      select: { email: true, timezone: true },
    });
    for (const h of hosts) {
      if (h.timezone && !out.has(h.email.toLowerCase())) {
        out.set(h.email.toLowerCase(), h.timezone);
      }
    }
  }
  return out;
}
