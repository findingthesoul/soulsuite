import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CenterShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { InviteSignInButton } from "./button";

// Public page hit by invitees clicking the invite link in their email. We don't bind the
// invite to the session here — the OAuth callback's resolvePostSignIn() does the actual
// claim by matching the signed-in user's email against any open invite for that address.
//
// This page just provides context ("you've been invited to join Soul as X") so the click is
// less mysterious before they sign in.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { workspace: true, project: true, invitedBy: true },
  });

  if (!invite) {
    return (
      <CenterShell>
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Invite not found</h1>
          <p className="text-sm text-muted-foreground">
            This link may have been revoked or is missing characters. Ask whoever invited you for a fresh link.
          </p>
        </div>
      </CenterShell>
    );
  }

  if (invite.acceptedAt) {
    return (
      <CenterShell>
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Already accepted</h1>
          <p className="text-sm text-muted-foreground">
            This invite was already accepted. <a href="/auth/signin" className="underline">Sign in</a> to continue.
          </p>
        </div>
      </CenterShell>
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <CenterShell>
        <div className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Invite expired</h1>
          <p className="text-sm text-muted-foreground">
            This link expired on {invite.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
            Ask {invite.invitedBy.name} for a fresh one.
          </p>
        </div>
      </CenterShell>
    );
  }

  if (invite.kind === "PROJECT") notFound(); // Project invites land elsewhere — wired in step 7.

  const ws = invite.workspace!;

  return (
    <CenterShell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>You&apos;ve been invited</CardTitle>
          <CardDescription>
            {invite.invitedBy.name} invited you to join <strong>{ws.name}</strong> as a <strong>{invite.role.toLowerCase()}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sign in with the Google account for <span className="font-mono text-foreground">{invite.email}</span>.
            The invite is locked to that address.
          </p>
          <InviteSignInButton />
        </CardContent>
      </Card>
    </CenterShell>
  );
}
