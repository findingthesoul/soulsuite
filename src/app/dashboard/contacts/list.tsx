"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface ContactRow {
  // null when this row is a workspace member without a corresponding Contact record. Such
  // rows are listed but not clickable — there's no /dashboard/contacts/[id] target.
  id: string | null;
  name: string | null;
  email: string;
  company: string | null;
  lastMeetingAt: string | null;
  isMember?: boolean;
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
            {filtered.map((c) => {
              const inner = (
                <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_2fr_1.5fr_1fr] items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                    </p>
                    {c.isMember && (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium bg-foreground/10 text-foreground">
                        Member
                      </span>
                    )}
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
                </div>
              );
              const key = c.id ?? c.email;
              return (
                <li key={key}>
                  {c.id ? (
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      className="block hover:bg-surface-muted transition-colors"
                    >
                      {inner}
                    </Link>
                  ) : (
                    // Workspace member with no Contact row yet — show but don't link.
                    <div className="opacity-90">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
