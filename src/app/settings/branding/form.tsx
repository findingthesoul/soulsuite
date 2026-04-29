"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Pencil } from "lucide-react";
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
  const [editing, setEditing] = useState(false);

  // Persisted values — what's saved on the server. We mirror these so Cancel can revert
  // without a refetch.
  const [committed, setCommitted] = useState({
    logoUrl: initial.logoUrl ?? "",
    brandColor: initial.brandColor ?? "#1c1917",
  });

  // Draft values — what's in the form. Synced from `committed` whenever Edit is clicked.
  const [logoUrl, setLogoUrl] = useState(committed.logoUrl);
  const [brandColor, setBrandColor] = useState(committed.brandColor);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setLogoUrl(committed.logoUrl);
    setBrandColor(committed.brandColor);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setLogoUrl(committed.logoUrl);
    setBrandColor(committed.brandColor);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    if (logoUrl.trim() && !logoUrl.startsWith("https://")) {
      return setError("Logo URL must start with https://");
    }
    if (!HEX_RE.test(brandColor)) {
      return setError("Brand colour must be a 6-digit hex (e.g. #1c1917).");
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
      setCommitted({ logoUrl: logoUrl.trim(), brandColor: brandColor.toLowerCase() });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Logo &amp; brand colour</CardTitle>
              <CardDescription>Used in the app header and (later) on public booking pages.</CardDescription>
            </div>
            {!editing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!editing ? (
            <>
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-subtle-foreground">Logo</p>
                {committed.logoUrl ? (
                  <Image
                    src={committed.logoUrl}
                    alt={`${initial.name} logo`}
                    width={120}
                    height={40}
                    unoptimized
                    className="h-10 w-auto object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Not set</p>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-subtle-foreground">Brand colour</p>
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block h-6 w-6 rounded-md border border-border"
                    style={{ backgroundColor: committed.brandColor }}
                    aria-hidden="true"
                  />
                  <code className="text-sm">{committed.brandColor}</code>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://…"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
                {logoUrl.startsWith("https://") && (
                  <div className="rounded-md border border-border bg-surface-muted p-4 mt-2">
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
              </div>
              <div className="space-y-1.5">
                <Label>Brand colour</Label>
                <div className="flex items-center gap-3">
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
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
