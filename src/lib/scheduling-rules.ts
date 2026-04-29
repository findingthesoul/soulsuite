// Allowed values for the meeting-type scheduling-rule fields. Centralised so the form, the
// API zod schema, and the read-only view all reference the same lists. Adding a new option is
// a single-line change.

export const BUFFER_MINUTES = [0, 5, 10, 15, 30, 60] as const;

export const MIN_NOTICE_MINUTES = [0, 15, 30, 60, 120, 240, 60 * 24, 60 * 24 * 2, 60 * 24 * 7] as const;

export const MAX_ADVANCE_DAYS = [1, 3, 7, 14, 30, 60, 90, 180] as const;

// Pretty-print helpers used by both the form selects and the read-only summary.

export function formatMinutes(m: number): string {
  if (m === 0) return "None";
  if (m < 60) return `${m} min`;
  if (m === 60) return "1 hour";
  if (m < 60 * 24) {
    const h = m / 60;
    return Number.isInteger(h) ? `${h} hours` : `${m} min`;
  }
  if (m === 60 * 24) return "1 day";
  if (m < 60 * 24 * 7) {
    const d = m / (60 * 24);
    return Number.isInteger(d) ? `${d} days` : `${m} min`;
  }
  if (m === 60 * 24 * 7) return "1 week";
  const w = m / (60 * 24 * 7);
  return Number.isInteger(w) ? `${w} weeks` : `${m} min`;
}

export function formatBuffer(before: number, after: number): string {
  if (before === 0 && after === 0) return "None";
  const parts: string[] = [];
  if (before > 0) parts.push(`${before} min before`);
  if (after > 0) parts.push(`${after} min after`);
  return parts.join(" · ");
}

export function formatMaxAdvanceDays(days: number): string {
  if (days === 1) return "1 day ahead";
  if (days < 7) return `${days} days ahead`;
  if (days === 7) return "1 week ahead";
  if (days < 30) return `${days / 7} weeks ahead`;
  if (days === 30) return "1 month ahead";
  if (days < 365) return `${days} days ahead`;
  return `${days / 365} years ahead`;
}
