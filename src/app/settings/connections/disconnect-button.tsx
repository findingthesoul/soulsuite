"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ZoomDisconnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Zoom? Meeting types still set to ZOOM will fail to create bookings until you reconnect.")) return;
    setBusy(true);
    const res = await fetch("/api/oauth/zoom/disconnect", { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <Button variant="secondary" onClick={disconnect} disabled={busy}>
      {busy ? "…" : "Disconnect"}
    </Button>
  );
}

export function MicrosoftDisconnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Microsoft? Meeting types still set to TEAMS will fail to create bookings until you reconnect.",
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/oauth/microsoft/disconnect", { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <Button variant="secondary" onClick={disconnect} disabled={busy}>
      {busy ? "…" : "Disconnect"}
    </Button>
  );
}
