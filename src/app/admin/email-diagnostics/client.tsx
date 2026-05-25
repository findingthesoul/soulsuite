"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  callerEmail: string;
  configured: boolean;
}

export function EmailDiagnosticsClient({ callerEmail, configured }: Props) {
  const router = useRouter();
  const [to, setTo] = useState(callerEmail);
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function fire() {
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/email-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        error?: string;
      };
      setResult({
        ok: Boolean(data.ok),
        reason: data.reason ?? data.error ?? (res.ok ? undefined : "unknown error"),
      });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send test email</CardTitle>
        <CardDescription>
          Fires a real Resend send. The history below picks it up immediately. Use this to
          confirm a specific recipient (e.g. a teammate who said they got nothing) actually
          receives — Resend shows them as Delivered in its dashboard if the send went through.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="testTo">Recipient</Label>
          <Input
            id="testTo"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
            placeholder="someone@somewhere.com"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {configured
              ? "Sender domain must be DNS-verified in Resend for delivery outside the Resend account owner."
              : "Configuration is incomplete — the send will be recorded as SKIPPED until env vars are set."}
          </p>
          <Button onClick={fire} disabled={pending || !to.trim()}>
            {pending ? "Sending…" : "Send test"}
          </Button>
        </div>
        {result && (
          <p
            className={`text-sm ${result.ok ? "text-foreground" : "text-destructive"}`}
          >
            {result.ok ? "Sent." : `Failed: ${result.reason ?? "unknown"}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
