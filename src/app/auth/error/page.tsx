import Link from "next/link";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Sign-in failed</h1>
        <p className="text-sm text-neutral-600">
          {reason ?? "Something went wrong during sign-in."}
        </p>
        <Link
          href="/auth/signin"
          className="inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
