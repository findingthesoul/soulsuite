"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Initial {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function BrandingForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [brandColor, setBrandColor] = useState(initial.brandColor ?? "#1c1917");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function submit() {
    setError(null);
    if (logoUrl.trim() && !logoUrl.startsWith("https://")) {
      setError("Logo URL must start with https://");
      return;
    }
    if (!HEX_RE.test(brandColor)) {
      setError("Brand colour must be a 6-digit hex (e.g. #1c1917).");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logoUrl: logoUrl.trim() || null,
          brandColor: brandColor.toLowerCase(),
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to save");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>Hosted image URL — uploads come later.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              placeholder="https://…"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </div>
          {logoUrl.startsWith("https://") && (
            <div className="rounded-md border border-border bg-surface-muted p-4">
              <p className="text-xs text-muted-foreground mb-2">Preview</p>
              <Image
                src={logoUrl}
                alt={`${initial.name} logo preview`}
                width={120}
                height={40}
                unoptimized
                className="h-10 w-auto object-contain"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand colour</CardTitle>
          <CardDescription>Used as the primary accent colour. Pick a hex you like.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              aria-label="Brand colour picker"
              className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
            />
            <Input
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="w-32 font-mono"
              maxLength={7}
            />
            <div
              className="h-10 flex-1 rounded-md border border-border"
              style={{ backgroundColor: HEX_RE.test(brandColor) ? brandColor : "transparent" }}
              aria-hidden="true"
            />
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {savedAt && !error && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
