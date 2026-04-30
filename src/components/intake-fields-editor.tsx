"use client";

import { Trash2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { type IntakeField, type FieldType, FIELD_TYPES, FIELD_TYPE_LABELS } from "@/lib/intake";

function autoKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function IntakeFieldsEditor({
  fields,
  onChange,
}: {
  fields: IntakeField[];
  onChange: (fields: IntakeField[]) => void;
}) {
  function update(idx: number, patch: Partial<IntakeField>) {
    const next = [...fields];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function addField() {
    const base: IntakeField = {
      key: `question-${fields.length + 1}`,
      label: "",
      type: "short",
      required: false,
    };
    onChange([...fields, base]);
  }

  function remove(idx: number) {
    const removed = fields[idx];
    // Cascade: drop conditionals pointing at the removed key.
    const next = fields
      .filter((_, i) => i !== idx)
      .map((f) => (f.conditionalOn?.fieldKey === removed.key ? { ...f, conditionalOn: undefined } : f));
    onChange(next);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  if (fields.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No questions yet. Bookings will only collect name + email.
        </p>
        <Button variant="secondary" size="sm" onClick={addField} type="button">
          <Plus className="h-3.5 w-3.5" /> Add a question
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {fields.map((field, idx) => (
          <li key={idx} className="rounded-md border border-border bg-surface p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-subtle-foreground pt-1">
                Question {idx + 1}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => move(idx, -1)} disabled={idx === 0} type="button" aria-label="Move up">
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(idx, 1)}
                  disabled={idx === fields.length - 1}
                  type="button"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(idx)} type="button" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`label-${idx}`}>Question</Label>
                <Input
                  id={`label-${idx}`}
                  value={field.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    // Auto-derive key from label until label has been touched once on a non-empty key.
                    const derivedKey = autoKey(label) || `question-${idx + 1}`;
                    update(idx, { label, key: field.key === `question-${idx + 1}` || !field.key ? derivedKey : field.key });
                  }}
                  placeholder="What would you like to discuss?"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`type-${idx}`}>Type</Label>
                <Select
                  id={`type-${idx}`}
                  value={field.type}
                  onChange={(e) => {
                    const type = e.target.value as FieldType;
                    const patch: Partial<IntakeField> = { type };
                    if (type === "select" && (!field.options || field.options.length === 0)) {
                      patch.options = ["Option 1"];
                    }
                    if (type !== "select") patch.options = undefined;
                    update(idx, patch);
                  }}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {field.type === "select" && (
              <div className="space-y-1.5">
                <Label>Options</Label>
                <div className="space-y-2">
                  {(field.options ?? []).map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={opt}
                        onChange={(e) => {
                          const next = [...(field.options ?? [])];
                          next[i] = e.target.value;
                          update(idx, { options: next });
                        }}
                        placeholder={`Option ${i + 1}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label="Remove option"
                        onClick={() => {
                          const next = (field.options ?? []).filter((_, j) => j !== i);
                          update(idx, { options: next });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => update(idx, { options: [...(field.options ?? []), ""] })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add option
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => update(idx, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-border accent-foreground"
                />
                Required
              </label>
            </div>

            <ConditionalEditor allFields={fields} idx={idx} update={update} />
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" onClick={addField} type="button">
        <Plus className="h-3.5 w-3.5" /> Add a question
      </Button>
    </div>
  );
}

function ConditionalEditor({
  allFields,
  idx,
  update,
}: {
  allFields: IntakeField[];
  idx: number;
  update: (idx: number, patch: Partial<IntakeField>) => void;
}) {
  const field = allFields[idx];
  // Conditionals can only depend on earlier fields, and only on fields with discrete answers.
  const candidates = allFields.slice(0, idx).filter((f) => f.type === "select" || f.type === "checkbox");
  if (candidates.length === 0) return null;

  const enabled = Boolean(field.conditionalOn);
  const refField = field.conditionalOn
    ? allFields.find((f) => f.key === field.conditionalOn!.fieldKey)
    : undefined;

  return (
    <div className="space-y-2 rounded-md bg-surface-muted px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              const first = candidates[0];
              const equals = first.type === "checkbox" ? "true" : first.options?.[0] ?? "";
              update(idx, { conditionalOn: { fieldKey: first.key, equals } });
            } else {
              update(idx, { conditionalOn: undefined });
            }
          }}
          className="h-4 w-4 rounded border-border accent-foreground"
        />
        Only show this question if…
      </label>

      {enabled && field.conditionalOn && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <Select
            value={field.conditionalOn.fieldKey}
            onChange={(e) => {
              const ref = candidates.find((c) => c.key === e.target.value);
              if (!ref) return;
              const equals = ref.type === "checkbox" ? "true" : ref.options?.[0] ?? "";
              update(idx, { conditionalOn: { fieldKey: ref.key, equals } });
            }}
          >
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label || c.key}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground sm:px-1">equals</span>
          {refField?.type === "checkbox" ? (
            <Select
              value={field.conditionalOn.equals}
              onChange={(e) =>
                update(idx, { conditionalOn: { ...field.conditionalOn!, equals: e.target.value } })
              }
            >
              <option value="true">checked</option>
              <option value="false">not checked</option>
            </Select>
          ) : (
            <Select
              value={field.conditionalOn.equals}
              onChange={(e) =>
                update(idx, { conditionalOn: { ...field.conditionalOn!, equals: e.target.value } })
              }
            >
              {(refField?.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
