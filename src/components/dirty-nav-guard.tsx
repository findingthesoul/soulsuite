"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Warns the user if they try to navigate away (internal link click or browser
 * close/refresh) while a form is dirty. Pair with `useDirtyState` + `<SaveBar>`.
 *
 * - Browser-level (close/refresh): native `beforeunload` prompt (browsers don't allow
 *   custom UI here).
 * - Internal `<Link>` clicks and back/forward: caught at document capture and replaced
 *   with a Save / Cancel modal.
 */
export function DirtyNavGuard({
  dirty,
  onSave,
}: {
  dirty: boolean;
  onSave: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const closeModal = () => setPendingHref(null);

  // When a save is in flight and dirty flips false, the form persisted successfully —
  // navigate to the pending href. If dirty stays true beyond a long timeout, the save
  // probably failed (the form will surface its own error); reset state so the user can act.
  React.useEffect(() => {
    if (!saving) return;
    if (!dirty && pendingHref) {
      const target = pendingHref;
      setSaving(false);
      setPendingHref(null);
      router.push(target);
    }
  }, [saving, dirty, pendingHref, router]);

  function handleSaveAndGo() {
    if (!pendingHref) return;
    setSaving(true);
    try {
      const ret = onSave();
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch(() => setSaving(false));
      }
    } catch {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!pendingHref} onOpenChange={(o) => !o && closeModal()}>
      <DialogHeader
        title="Unsaved changes"
        description="You haven't saved the changes on this page yet."
        onClose={closeModal}
      />
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          Save your changes before leaving, or stay on this page to keep editing.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={closeModal} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSaveAndGo} disabled={saving}>
          {saving ? "Saving…" : "Save and continue"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
