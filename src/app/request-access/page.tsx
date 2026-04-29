import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CenterShell } from "@/components/app-shell";

// Lands here when an @soul.com account signs in without a pending workspace invite.
// V1: just a static "ask an admin" page; later, a self-serve "request access" form.
export default async function RequestAccessPage() {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");

  return (
    <CenterShell>
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Access requested</h1>
        <p className="text-sm text-muted-foreground">
          {host.email} isn&apos;t a workspace member yet. Ask a workspace owner or admin to send you an invite.
        </p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          <Link href="/" className="underline">Back to home</Link>
        </p>
      </div>
    </CenterShell>
  );
}
