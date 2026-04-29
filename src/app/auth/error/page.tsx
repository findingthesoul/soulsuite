import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CenterShell } from "@/components/app-shell";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <CenterShell>
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in failed</h1>
        <p className="text-sm text-muted-foreground">
          {reason ?? "Something went wrong during sign-in."}
        </p>
        <Link href="/auth/signin" className={buttonVariants({ variant: "secondary" })}>
          Try again
        </Link>
      </div>
    </CenterShell>
  );
}
