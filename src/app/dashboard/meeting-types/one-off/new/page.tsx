import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { OneOffMeetingTypeForm } from "./form";

export default async function NewOneOffMeetingTypePage() {
  const ctx = await getPageContextOrRedirect();
  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New one-off meeting</h1>
          <p className="text-sm text-muted-foreground">
            Hand-pick specific time slots — invitees claim a slot directly without checking availability.
          </p>
        </header>
        <OneOffMeetingTypeForm
          hostSlug={ctx.host.slug}
          hostHasZoom={!!ctx.host.zoomRefreshToken}
          hostHasPersonalRoom={!!ctx.host.personalRoomUrl}
        />
      </div>
    </AppShell>
  );
}
