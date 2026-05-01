"use client";

import { Button } from "@/components/ui/button";

// Top-right Save / Discard pair for direct-edit forms. Hidden when the form is clean
// (no dirty changes). Renders nothing when not needed — caller can drop it next to a
// page header without worrying about empty space.
//
// Pattern matches the new "no view-mode toggle" form interaction: the form's inputs
// are always editable, and this bar surfaces only when the user has unsaved changes.
export function SaveBar({
  dirty,
  pending,
  onSave,
  onDiscard,
  saveLabel = "Save",
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  if (!dirty && !pending) return null;
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onDiscard} disabled={pending}>
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={pending || !dirty}>
        {pending ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
