"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function autoSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(autoSlug(value));
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError("Name is required.");
    if (!SLUG_RE.test(slug)) {
      return setError("Slug must be 2–40 chars, lowercase letters/digits/hyphens.");
    }
    startTransition(async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to create project");
        return;
      }
      const data = (await res.json()) as { slug: string };
      router.push(`/dashboard/projects/${data.slug}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Name your engagement and pick a URL slug.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My project"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugTouched(true);
                }}
                placeholder="my-project"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used in the booking URL: /<span className="font-mono">{slug || "<slug>"}</span>/&lt;meeting&gt;
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Visible to project members."
              className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/dashboard/projects")} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </div>
  );
}
