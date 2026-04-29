import Link from "next/link";
import { getCurrentHost } from "@/lib/auth";
import { redirect } from "next/navigation";

// Lands here when an @soul.com account signs in without a pending workspace invite.
// V1: just a static "ask an admin" page; later, a self-serve "request access" form.
export default async function RequestAccessPage() {
  const host = await getCurrentHost();
  if (!host) redirect("/auth/signin");

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Access requested</h1>
        <p className="text-sm text-neutral-600">
          {host.email} isn&apos;t a workspace member yet. Ask a workspace owner or admin to send you an invite.
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Sign out
          </button>
        </form>
        <p className="text-xs text-neutral-500">
          <Link href="/" className="underline">Back to home</Link>
        </p>
      </div>
    </main>
  );
}
