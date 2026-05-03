import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "./form";

export default async function ProfilePage() {
  const ctx = await getPageContextOrRedirect();
  const { host } = ctx;
  // Count of MTs that depend on this host's personalRoomUrl — used to warn before clearing.
  // Personal MTs: hostId. Project MTs where this host is the conferencingHost (COLLECTIVE) or
  // among assignedHostIds (SINGLE / ROUND_ROBIN).
  const personalRoomMtCount = await prisma.meetingType.count({
    where: {
      conferencingProvider: "PERSONAL_ROOM",
      OR: [
        { hostId: host.id },
        { conferencingHostId: host.id },
        { assignedHostIds: { has: host.id } },
      ],
    },
  });
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
            personalRoomUrl: host.personalRoomUrl,
            personalRoomMtCount,
          }}
        />
      </div>
    </AppShell>
  );
}
