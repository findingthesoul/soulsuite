import { notFound } from "next/navigation";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { MeetingTypeForm } from "../form";

export default async function EditMeetingTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getPageContextOrRedirect();

  const mt = await prisma.meetingType.findUnique({ where: { id } });
  if (!mt || mt.scope !== "PERSONAL" || mt.hostId !== ctx.host.id) notFound();

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit meeting type</h1>
          <p className="text-sm text-muted-foreground">
            Booking link: <code className="text-xs">/{ctx.host.slug}/{mt.slug}</code>
          </p>
        </header>
        <MeetingTypeForm
          hostSlug={ctx.host.slug}
          initial={{
            id: mt.id,
            name: mt.name,
            slug: mt.slug,
            description: mt.description,
            durationMinutes: mt.durationMinutes,
            isActive: mt.isActive,
          }}
        />
      </div>
    </AppShell>
  );
}
