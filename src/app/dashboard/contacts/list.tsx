"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface ContactRow {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  lastMeetingAt: string | null;
}

export function ContactsList({ rows }: { rows: ContactRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        (r.name && r.name.toLowerCase().includes(q)) ||
        r.email.toLowerCase().includes(q) ||
        (r.company && r.company.toLowerCase().includes(q))
      );
    });
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search by name, email, or company"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
      />

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <div className="p-8 text-center text-sm text-muted-foreground">
            No contacts match &ldquo;{query}&rdquo;.
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/contacts/${c.id}`}
                  className="grid grid-cols-1 sm:grid-cols-[1.5fr_2fr_1.5fr_1fr] items-center gap-3 px-4 py-3 hover:bg-surface-muted transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">
                      {c.company ?? <span className="text-subtle-foreground">—</span>}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">
                      {c.lastMeetingAt
                        ? new Date(c.lastMeetingAt).toLocaleDateString()
                        : <span className="text-subtle-foreground">No meetings</span>}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
