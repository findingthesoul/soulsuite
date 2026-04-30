"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { type IntakeField, isFieldVisible } from "@/lib/intake";

export function IntakeFieldsRenderer({
  fields,
  answers,
  onChange,
  errorKey,
}: {
  fields: IntakeField[];
  answers: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errorKey?: string | null;
}) {
  function set(key: string, value: unknown) {
    onChange({ ...answers, [key]: value });
  }

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        if (!isFieldVisible(f, answers)) return null;
        const id = `intake-${f.key}`;
        const hasError = errorKey === f.key;
        const errClass = hasError ? "border-destructive" : "";

        if (f.type === "long") {
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id}>
                {f.label}
                {f.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <textarea
                id={id}
                value={(answers[f.key] as string) ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                rows={4}
                className={`flex w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${errClass || "border-border"}`}
              />
            </div>
          );
        }

        if (f.type === "select") {
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id}>
                {f.label}
                {f.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Select
                id={id}
                value={(answers[f.key] as string) ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={errClass}
              >
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          );
        }

        if (f.type === "checkbox") {
          return (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(answers[f.key])}
                onChange={(e) => set(f.key, e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-border accent-foreground"
              />
              <span className={hasError ? "text-destructive" : "text-foreground"}>
                {f.label}
                {f.required && <span className="text-destructive ml-0.5">*</span>}
              </span>
            </label>
          );
        }

        return (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {f.label}
              {f.required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            <Input
              id={id}
              type={f.type === "email" ? "email" : "text"}
              value={(answers[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className={errClass}
            />
          </div>
        );
      })}
    </div>
  );
}
