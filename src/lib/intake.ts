import { z } from "zod";

// Intake field types we support in v1. Schema comment also lists "multi" (multi-select) but we
// skip that for now — single-select covers the common case and avoids the heavier multi-select UI.
export const FIELD_TYPES = ["short", "long", "email", "select", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short: "Short text",
  long: "Long text",
  email: "Email",
  select: "Single choice",
  checkbox: "Checkbox",
};

export interface IntakeField {
  key: string;            // unique within a form; lowercase letters/digits/hyphens
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];     // for select
  conditionalOn?: { fieldKey: string; equals: string }; // show only if other field equals this value
}

const KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const intakeFieldSchema: z.ZodType<IntakeField> = z
  .object({
    key: z.string().regex(KEY_RE, "Field key must be 2–40 chars: lowercase letters/digits/hyphens"),
    label: z.string().trim().min(1).max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).optional(),
    conditionalOn: z
      .object({ fieldKey: z.string().min(1), equals: z.string().min(1) })
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select") {
      if (!field.options || field.options.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: `"${field.label}" needs at least one option.`,
        });
      }
    }
  });

export const intakeFieldsSchema = z
  .array(intakeFieldSchema)
  .max(20)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field key "${f.key}".` });
      }
      seen.add(f.key);
    }
    // Validate conditional references point at earlier fields with matching options/values.
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.conditionalOn) continue;
      const refIdx = fields.findIndex((x) => x.key === f.conditionalOn!.fieldKey);
      if (refIdx === -1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${f.label}" depends on a missing field.` });
        continue;
      }
      if (refIdx >= i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${f.label}" must come after the field it depends on.`,
        });
      }
    }
  });

// Validate intake field *definitions* (not answers — see validateAnswers below). Mirrors the
// server-side zod schema so the MT form can surface a friendly per-field message and jump to
// the Intake tab before the API round-trip. Returns null when the array is well-formed, or a
// `{ index, message }` for the first problem found (1-based numbering in messages for humans).
export function validateIntakeFieldDefinitions(
  fields: IntakeField[],
): { index: number; message: string } | null {
  if (fields.length > 20) {
    return { index: 0, message: "Too many intake questions (max 20)." };
  }
  const seen = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const human = `Question ${i + 1}`;
    if (!f.label || !f.label.trim()) {
      return { index: i, message: `${human}: label is required.` };
    }
    if (f.label.length > 120) {
      return { index: i, message: `${human}: label is too long (max 120 characters).` };
    }
    if (!KEY_RE.test(f.key)) {
      return {
        index: i,
        message: `${human} ("${f.label}"): key must be 2–40 chars (lowercase letters, digits, hyphens).`,
      };
    }
    if (seen.has(f.key)) {
      return { index: i, message: `${human} ("${f.label}"): duplicate key "${f.key}".` };
    }
    seen.add(f.key);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) {
      return { index: i, message: `${human} ("${f.label}"): unsupported type.` };
    }
    if (f.type === "select") {
      if (!f.options || f.options.length === 0) {
        return { index: i, message: `${human} ("${f.label}"): add at least one option.` };
      }
      const emptyAt = f.options.findIndex((o) => !o || !o.trim());
      if (emptyAt !== -1) {
        return {
          index: i,
          message: `${human} ("${f.label}"): option ${emptyAt + 1} is empty.`,
        };
      }
    }
    if (f.conditionalOn) {
      const refIdx = fields.findIndex((x) => x.key === f.conditionalOn!.fieldKey);
      if (refIdx === -1) {
        return { index: i, message: `${human} ("${f.label}") depends on a missing field.` };
      }
      if (refIdx >= i) {
        return {
          index: i,
          message: `${human} ("${f.label}") must come after the field it depends on.`,
        };
      }
    }
  }
  return null;
}

// Decide whether a field is currently visible given the answers so far.
export function isFieldVisible(field: IntakeField, answers: Record<string, unknown>): boolean {
  if (!field.conditionalOn) return true;
  const answer = answers[field.conditionalOn.fieldKey];
  return String(answer ?? "") === field.conditionalOn.equals;
}

// Validate answers against fields. Returns null if valid, or a per-field error message.
export function validateAnswers(
  fields: IntakeField[],
  answers: Record<string, unknown>,
): { fieldKey: string; message: string } | null {
  for (const field of fields) {
    if (!isFieldVisible(field, answers)) continue;
    const raw = answers[field.key];

    if (field.type === "checkbox") {
      if (field.required && raw !== true) {
        return { fieldKey: field.key, message: `"${field.label}" is required.` };
      }
      continue;
    }

    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) {
      return { fieldKey: field.key, message: `"${field.label}" is required.` };
    }
    if (!value) continue;

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { fieldKey: field.key, message: `"${field.label}" must be a valid email.` };
    }
    if (field.type === "select" && (!field.options || !field.options.includes(value))) {
      return { fieldKey: field.key, message: `"${field.label}" has an invalid option.` };
    }
    if (value.length > 2000) {
      return { fieldKey: field.key, message: `"${field.label}" is too long.` };
    }
  }
  return null;
}

// Drop answers whose field is hidden by conditional logic. Saves cleaner data and avoids
// leaking answers the user expected to be discarded.
export function pruneHiddenAnswers(
  fields: IntakeField[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isFieldVisible(field, answers)) continue;
    if (field.key in answers) out[field.key] = answers[field.key];
  }
  return out;
}
