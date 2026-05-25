"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Copy, Check, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";

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
  kind: "internal" | "external";
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

  // Add-member error surfaced by the dialog. Selection + role live inside the dialog itself
  // (per-open) so we just bubble the failure message up here for the parent to render.
  const [addError, setAddError] = useState<string | null>(null);

  // External invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"LEAD" | "MEMBER">("MEMBER");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState(false);

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

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length === 1 ? "1 person on this team." : `${members.length} people on this team.`}
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Add teammate
        </Button>
      </div>

      <AddTeammateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        candidates={candidates}
        pending={pending}
        addError={addError}
        inviteError={inviteError}
        justCopied={justCopied}
        onAdd={(hostIds, role) => {
          if (hostIds.length === 0) return;
          setAddError(null);
          // Sequential POSTs so a partial failure surfaces the *first* error rather than racing
          // — and so audit logs show one row per addition. For the team sizes we have (handful
          // at most per add), the latency is fine.
          startTransition(async () => {
            const failures: string[] = [];
            for (const hostId of hostIds) {
              const res = await fetch(`/api/projects/${projectId}/members`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ hostId, role }),
              });
              if (!res.ok) {
                failures.push((await res.text()) || `Failed to add ${hostId}`);
              }
            }
            if (failures.length > 0) {
              setAddError(failures.join(" · "));
              router.refresh();
              return;
            }
            setAddOpen(false);
            router.refresh();
          });
        }}
        onInvite={(email, role) => {
          const trimmed = email.trim().toLowerCase();
          if (!trimmed) return;
          setInviteError(null);
          startTransition(async () => {
            const res = await fetch(`/api/projects/${projectId}/invites`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: trimmed, role }),
            });
            if (!res.ok) {
              setInviteError((await res.text()) || "Failed to create invite");
              return;
            }
            const data = (await res.json()) as { url: string };
            try {
              await navigator.clipboard.writeText(data.url);
              setJustCopied(true);
              setTimeout(() => setJustCopied(false), 3000);
            } catch {
              // Clipboard unavailable — link still on the pending list.
            }
            setAddOpen(false);
            router.refresh();
          });
        }}
      />

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

// ────────────────────────────────────────────────────────────
// Add-teammate dialog
// ────────────────────────────────────────────────────────────

function AddTeammateDialog({
  open,
  onOpenChange,
  candidates,
  pending,
  addError,
  inviteError,
  justCopied,
  onAdd,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: Candidate[];
  pending: boolean;
  addError: string | null;
  inviteError: string | null;
  justCopied: boolean;
  onAdd: (hostIds: string[], role: "LEAD" | "MEMBER") => void;
  onInvite: (email: string, role: "LEAD" | "MEMBER") => void;
}) {
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [pickRole, setPickRole] = useState<"LEAD" | "MEMBER">("MEMBER");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"LEAD" | "MEMBER">("MEMBER");

  // Reset checkboxes whenever the dialog re-opens so a stale selection from a previous use
  // can't leak into a fresh "Add teammate" session.
  React.useEffect(() => {
    if (open) setSelectedIds(new Set());
  }, [open]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible(visibleIds: string[], on: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader
        title="Add teammate"
        description="Pick someone Soul Suite already knows, or invite a new email."
        onClose={() => onOpenChange(false)}
      />

      <div className="px-5 pt-4 flex gap-1 border-b border-border -mb-px">
        <TabButton active={tab === "existing"} onClick={() => setTab("existing")}>
          From existing ({candidates.length})
        </TabButton>
        <TabButton active={tab === "new"} onClick={() => setTab("new")}>
          Invite new
        </TabButton>
      </div>

      <DialogBody className="max-h-[60vh] overflow-y-auto">
        {tab === "existing" ? (
          candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suggestions yet. Switch to <button type="button" className="underline" onClick={() => setTab("new")}>Invite new</button> to add someone by email,
              or grow the internal team in{" "}
              <a href="/settings/members" className="underline hover:text-foreground">
                Settings → Internal team
              </a>
              .
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="pl-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="addRole">Role</Label>
                <Select id="addRole" value={pickRole} onChange={(e) => setPickRole(e.target.value as "LEAD" | "MEMBER")}>
                  <option value="MEMBER">Member</option>
                  <option value="LEAD">Lead</option>
                </Select>
              </div>

              {(() => {
                const visibleIds = filtered.map((c) => c.id);
                const visibleSelected = visibleIds.filter((id) => selectedIds.has(id));
                const allVisibleSelected =
                  visibleIds.length > 0 && visibleSelected.length === visibleIds.length;
                return (
                  <>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => toggleAllVisible(visibleIds, e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-foreground"
                          disabled={visibleIds.length === 0}
                        />
                        Select all{search ? " matching" : ""}
                      </label>
                      <span>
                        {selectedIds.size} selected
                      </span>
                    </div>

                    <ul className="rounded-md border border-border divide-y divide-border max-h-[40vh] overflow-y-auto">
                      {filtered.length === 0 ? (
                        <li className="p-4 text-sm text-muted-foreground text-center">No matches.</li>
                      ) : (
                        filtered.map((c) => {
                          const checked = selectedIds.has(c.id);
                          return (
                            <li key={c.id}>
                              <label
                                className={`w-full flex items-center justify-between gap-3 p-3 text-left text-sm transition-colors cursor-pointer ${
                                  checked ? "bg-surface-muted" : "hover:bg-surface-muted"
                                } ${pending ? "opacity-50 pointer-events-none" : ""}`}
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(c.id)}
                                    disabled={pending}
                                    className="h-4 w-4 rounded border-border accent-foreground shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <p className="font-medium text-foreground truncate">{c.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                    c.kind === "internal"
                                      ? "bg-foreground/10 text-foreground"
                                      : "bg-surface-muted text-muted-foreground"
                                  }`}
                                >
                                  {c.kind}
                                </span>
                              </label>
                            </li>
                          );
                        })
                      )}
                    </ul>
                    {addError && <p className="text-sm text-destructive">{addError}</p>}
                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={() => onAdd(Array.from(selectedIds), pickRole)}
                        disabled={pending || selectedIds.size === 0}
                      >
                        {pending
                          ? "Adding…"
                          : selectedIds.size === 0
                            ? "Add"
                            : `Add ${selectedIds.size} as ${pickRole === "LEAD" ? "Lead" : "Member"}${selectedIds.size === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </>
          )
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="newInviteEmail">Email</Label>
              <Input
                id="newInviteEmail"
                type="email"
                autoFocus
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@partner.example"
                onKeyDown={(e) => e.key === "Enter" && onInvite(inviteEmail, inviteRole)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newInviteRole">Role</Label>
              <Select
                id="newInviteRole"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "LEAD" | "MEMBER")}
              >
                <option value="MEMBER">Member</option>
                <option value="LEAD">Lead</option>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              They&apos;ll get an email with a sign-in link, scoped to this team only. Any email
              works — no @soul.com required.
            </p>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
            {justCopied && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                Invite link also copied to your clipboard.
              </p>
            )}
          </>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {tab === "new" && (
          <Button onClick={() => onInvite(inviteEmail, inviteRole)} disabled={pending || !inviteEmail.trim()}>
            {pending ? "Creating…" : "Send invite"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
