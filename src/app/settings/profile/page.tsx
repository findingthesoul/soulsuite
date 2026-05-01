import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "./form";

export default async function ProfilePage() {
  const ctx = await getPageContextOrRedirect();
  const { host } = ctx;
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">
            How you appear to teammates and invitees. Your sign-in email is fixed.
          </p>
        </header>
        <ProfileForm
          initial={{
            name: host.name,
            email: host.email,
            phone: host.phone,
            location: host.location,
            bio: host.bio,
            photoUrl: host.photoUrl,
          }}
        />
      </div>
    </AppShell>
  );
}
