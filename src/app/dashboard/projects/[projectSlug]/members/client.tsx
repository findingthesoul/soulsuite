"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Member {
  id: string;
  hostId: string;
  name: string;
  email: string;
  role: string;
  isExternal: boolean;
}

interface Candidate {
  id: string;
  name: string;
  email: string;
}

export function ProjectMembersClient({
  projectId,
  currentHostId,
  members,
  candidates,
}: {
  projectId: string;
  currentHostId: string;
  members: Member[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pickHostId, setPickHostId] = useState(candidates[0]?.id ?? "");
  const [pickRole, setPickRole] = useState<"LEAD" | "MEMBER">("MEMBER");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!pickHostId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: pickHostId, role: pickRole }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to add");
        return;
      }
      router.refresh();
    });
  }

  function remove(memberId: string) {
    if (!confirm("Remove this member from the project?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
      if (!res.ok) {
        alert((await res.text()) || "Failed to remove");
        return;
      }
      router.refresh();
    });
  }

  function setRole(memberId: string, role: "LEAD" | "MEMBER") {
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        alert((await res.text()) || "Failed to update role");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a workspace member</CardTitle>
          <CardDescription>People already in the workspace who aren&apos;t yet on this project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone in the workspace is already on this project.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div className="space-y-1.5">
                  <Label htmlFor="pickHost">Person</Label>
                  <Select id="pickHost" value={pickHostId} onChange={(e) => setPickHostId(e.target.value)}>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.email}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pickRole">Role</Label>
                  <Select
                    id="pickRole"
                    value={pickRole}
                    onChange={(e) => setPickRole(e.target.value as "LEAD" | "MEMBER")}
                  >
                    <option value="MEMBER">Member</option>
                    <option value="LEAD">Lead</option>
                  </Select>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end">
                <Button onClick={add} disabled={pending}>
                  {pending ? "Adding…" : "Add to project"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current members ({members.length})</CardTitle>
          <CardDescription>Leads can edit project settings + meeting types. Members can view.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border -mx-1">
            {members.map((m) => {
              const isMe = m.hostId === currentHostId;
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {m.name}
                      {isMe && <span className="ml-2 text-xs text-subtle-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.email}
                      {m.isExternal && " · external"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={m.role}
                      onChange={(e) => setRole(m.id, e.target.value as "LEAD" | "MEMBER")}
                      disabled={pending || isMe}
                      className="h-8 w-28 text-xs"
                    >
                      <option value="LEAD">Lead</option>
                      <option value="MEMBER">Member</option>
                    </Select>
                    {!isMe && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove member"
                        onClick={() => remove(m.id)}
                        disabled={pending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
