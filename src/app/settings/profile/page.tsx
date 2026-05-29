import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "./form";

export default async function ProfilePage() {
  const ctx = await getPageContextOrRedirect();
  const { host } = ctx;
  // MT counts per personal-room flavour — used to warn before clearing a URL the MTs depend on.
  // Personal MTs: hostId. Project MTs where this host is the conferencingHost (COLLECTIVE) or
  // among assignedHostIds (SINGLE / ROUND_ROBIN).
  const [personalZoomRoomMtCount, personalTeamsRoomMtCount] = await Promise.all([
    prisma.meetingType.count({
      where: {
        conferencingProvider: "PERSONAL_ZOOM_ROOM",
        OR: [
          { hostId: host.id },
          { conferencingHostId: host.id },
          { assignedHostIds: { has: host.id } },
        ],
      },
    }),
    prisma.meetingType.count({
      where: {
        conferencingProvider: "PERSONAL_TEAMS_ROOM",
        OR: [
          { hostId: host.id },
          { conferencingHostId: host.id },
          { assignedHostIds: { has: host.id } },
        ],
      },
    }),
  ]);
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
            personalZoomRoomUrl: host.personalZoomRoomUrl,
            personalTeamsRoomUrl: host.personalTeamsRoomUrl,
            personalZoomRoomMtCount,
            personalTeamsRoomMtCount,
            requireApprovalDefault: host.requireApprovalDefault,
          }}
        />
      </div>
    </AppShell>
  );
}
