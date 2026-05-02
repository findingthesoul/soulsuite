import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "./form";

export default async function ProfilePage() {
  const ctx = await getPageContextOrRedirect();
  const { host } = ctx;
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl">
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
