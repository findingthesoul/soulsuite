"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function OrganisationsClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [domain, setDomain] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeName(v: string) {
    setName(v);
    if (!slugTouched) setSlug(autoSlug(v));
  }

  function submit() {
    setError(null);
    setSuccess(null);
    if (name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    const d = domain.trim().toLowerCase();
    if (!DOMAIN_RE.test(d)) return setError("Domain looks invalid (e.g. acme.com).");
    if (ownerEmail.trim() && !ownerEmail.includes("@")) {
      return setError("Owner email looks invalid.");
    }
    if (ownerEmail.trim() && !ownerEmail.toLowerCase().endsWith(`@${d}`)) {
      return setError(`Owner email should be on @${d}.`);
    }

    startTransition(async () => {
      const res = await fetch("/api/admin/organisations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          primaryEmailDomain: d,
          ownerEmail: ownerEmail.trim() || null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to create organisation.");
        return;
      }
      setSuccess(`Created ${name.trim()} (@${d}). The owner can now sign in.`);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDomain("");
      setOwnerEmail("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an organisation</CardTitle>
        <CardDescription>
          Pick a friendly name + slug, register the email domain, and (optionally) name the
          initial owner. If the owner email is given and a host with that email already exists,
          they become OWNER immediately; otherwise they&apos;re promoted on first sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => changeName(e.target.value)}
            placeholder="Acme Inc"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-slug">Slug</Label>
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugTouched(true);
            }}
            placeholder="acme"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-domain">Primary email domain</Label>
          <Input
            id="org-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value.toLowerCase())}
            placeholder="acme.com"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Anyone signing in with an @{domain || "acme.com"} email lands in this workspace.
            Must be unique across Soul Suite.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-owner">Initial owner email (optional)</Label>
          <Input
            id="org-owner"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder={`founder@${domain || "acme.com"}`}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-foreground">{success}</p>}
        <div className="pt-2 flex justify-end">
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create organisation"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
