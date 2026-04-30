"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export function ProjectMembersClient({
  projectId,
  currentHostId,
  members,
  candidates,
  pendingInvites,
}: {
  projectId: string;
  currentHostId: string;
  members: Member[];
  candidates: Candidate[];
  pendingInvites: PendingInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Workspace member picker
  const [pickHostId, setPickHostId] = useState(candidates[0]?.id ?? "");
  const [pickRole, setPickRole] = useState<"LEAD" | "MEMBER">("MEMBER");
  const [addError, setAddError] = useState<string | null>(null);

  // External invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"LEAD" | "MEMBER">("MEMBER");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState(false);

  function add() {
    if (!pickHostId) return;
    setAddError(null);
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: pickHostId, role: pickRole }),
      });
      if (!res.ok) {
        setAddError((await res.text()) || "Failed to add");
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

  function sendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviteError(null);
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        setInviteError((await res.text()) || "Failed to create invite");
        return;
      }
      const data = (await res.json()) as { url: string };
      setInviteEmail("");
      try {
        await navigator.clipboard.writeText(data.url);
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 3000);
      } catch {
        // Clipboard unavailable — user can copy from pending list.
      }
      router.refresh();
    });
  }

  function revokeInvite(inviteId: string) {
    if (!confirm("Revoke this invite?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/invites/${inviteId}`, { method: "DELETE" });
      if (!res.ok) {
        alert((await res.text()) || "Failed to revoke");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Add a workspace member</CardTitle>
            <CardDescription>People already in the workspace who aren&apos;t yet on this project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <div className="flex justify-end">
              <Button onClick={add} disabled={pending}>
                {pending ? "Adding…" : "Add to project"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Invite an external collaborator</CardTitle>
          <CardDescription>
            Send a link to anyone — no @soul.com domain required. They sign in with the invited address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="inviteEmail">Email address</Label>
              <Input
                id="inviteEmail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@partner.example"
                onKeyDown={(e) => e.key === "Enter" && sendInvite()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inviteRole">Role</Label>
              <Select
                id="inviteRole"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "LEAD" | "MEMBER")}
              >
                <option value="MEMBER">Member</option>
                <option value="LEAD">Lead</option>
              </Select>
            </div>
          </div>
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
          {justCopied && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
              Invite link copied to clipboard.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={sendInvite} disabled={pending || !inviteEmail.trim()}>
              {pending ? "Creating…" : "Create invite link"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites ({pendingInvites.length})</CardTitle>
            <CardDescription>Links that haven&apos;t been accepted yet. Valid for 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mx-1">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.role.toLowerCase()} · expires{" "}
                      {new Date(inv.expiresAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CopyLinkButton projectId={projectId} inviteId={inv.id} />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Revoke invite"
                      onClick={() => revokeInvite(inv.id)}
                      disabled={pending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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

function CopyLinkButton({ projectId, inviteId }: { projectId: string; inviteId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  async function copy() {
    setState("loading");
    try {
      const res = await fetch(`/api/projects/${projectId}/invites/${inviteId}`);
      if (!res.ok) {
        setState("idle");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
    }
  }

  return (
    <Button variant="ghost" size="icon" aria-label="Copy invite link" onClick={copy} disabled={state === "loading"}>
      {state === "copied" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
