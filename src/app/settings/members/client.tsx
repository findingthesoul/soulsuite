"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  url: string;
}

export function MembersClient({
  myRole,
  primaryEmailDomain,
  invites,
}: {
  myRole: string;
  primaryEmailDomain: string;
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canInviteAdmin = myRole === "OWNER";

  function send() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Enter a valid email address.");
    }
    if (!email.toLowerCase().endsWith(`@${primaryEmailDomain}`)) {
      return setError(`Workspace invites must use @${primaryEmailDomain} addresses.`);
    }
    startTransition(async () => {
      const res = await fetch("/api/settings/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Failed to invite");
        return;
      }
      setEmail("");
      setRole("MEMBER");
      router.refresh();
    });
  }

  function revoke(id: string) {
    if (!confirm("Revoke this invite? The link will stop working.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/settings/invites/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert((await res.text()) || "Failed to revoke");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite a member</CardTitle>
          <CardDescription>
            They&apos;ll get a link they can click to sign in with Google. Email must be @{primaryEmailDomain}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`name@${primaryEmailDomain}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN" disabled={!canInviteAdmin}>
                  Admin{canInviteAdmin ? "" : " (owner only)"}
                </option>
              </Select>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button onClick={send} disabled={pending}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites ({invites.length})</CardTitle>
          <CardDescription>
            Invites expire 7 days after they&apos;re sent. Email delivery is on the backlog — copy the link and send it
            yourself for now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">None pending.</p>
          ) : (
            <ul className="divide-y divide-border -mx-1">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-start justify-between gap-3 px-1 py-3 text-sm">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground truncate">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {invite.role.toLowerCase()} · invited by {invite.invitedByName} · expires{" "}
                      {new Date(invite.expiresAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    <CopyableLink url={invite.url} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Revoke invite"
                    onClick={() => revoke(invite.id)}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Copy className="h-3 w-3" />
      <code className="truncate max-w-[260px] sm:max-w-none">{copied ? "Copied!" : url}</code>
    </button>
  );
}
