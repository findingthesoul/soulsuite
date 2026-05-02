"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "@/components/save-bar";
import { DirtyNavGuard } from "@/components/dirty-nav-guard";
import { useDirtyState } from "@/lib/use-dirty-state";

interface Initial {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

interface Draft {
  logoUrl: string;
  brandColor: string;
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function BrandingForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { draft, dirty, update, discard, commit } = useDirtyState<Draft>({
    logoUrl: initial.logoUrl ?? "",
    brandColor: initial.brandColor ?? "#1c1917",
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (draft.logoUrl.trim() && !draft.logoUrl.startsWith("https://")) {
      return setError("Logo URL must start with https://");
    }
    if (!HEX_RE.test(draft.brandColor)) {
      return setError("Brand colour must be a 6-digit hex (e.g. #1c1917).");
    }
    startTransition(async () => {
      const next: Draft = {
        logoUrl: draft.logoUrl.trim(),
        brandColor: draft.brandColor.toLowerCase(),
      };
      const res = await fetch("/api/settings/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logoUrl: next.logoUrl || null,
          brandColor: next.brandColor,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      commit(next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Logo and brand colour for {initial.name}. Used in the app header and (later) on public booking pages.
          </p>
        </div>
        <SaveBar dirty={dirty} pending={pending} onSave={save} onDiscard={discard} />
      </header>
      <DirtyNavGuard dirty={dirty} onSave={save} />

      <Card>
        <CardHeader>
          <CardTitle>Logo &amp; brand colour</CardTitle>
          <CardDescription>Used in the app header and (later) on public booking pages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              placeholder="https://…"
              value={draft.logoUrl}
              onChange={(e) => update({ logoUrl: e.target.value })}
            />
            {draft.logoUrl.startsWith("https://") && (
              <div className="rounded-md border border-border bg-surface-muted p-4 mt-2">
                <p className="text-xs text-muted-foreground mb-2">Preview</p>
                <Image
                  src={draft.logoUrl}
                  alt={`${initial.name} logo preview`}
                  width={120}
                  height={40}
                  unoptimized
                  className="h-10 w-auto object-contain"
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Brand colour</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={draft.brandColor}
                onChange={(e) => update({ brandColor: e.target.value })}
                aria-label="Brand colour picker"
                className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
              />
              <Input
                value={draft.brandColor}
                onChange={(e) => update({ brandColor: e.target.value })}
                className="w-32 font-mono"
                maxLength={7}
              />
              <div
                className="h-10 flex-1 rounded-md border border-border"
                style={{ backgroundColor: HEX_RE.test(draft.brandColor) ? draft.brandColor : "transparent" }}
                aria-hidden="true"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
