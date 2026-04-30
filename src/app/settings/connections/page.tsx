import Link from "next/link";
import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isZoomConfigured } from "@/lib/zoom/client";
import { ZoomDisconnectButton } from "./disconnect-button";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ zoom_connected?: string; zoom_error?: string }>;
}) {
  const ctx = await getPageContextOrRedirect();
  const sp = await searchParams;
  const zoomReady = isZoomConfigured();
  const isConnected = !!ctx.host.zoomRefreshToken;

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          <p className="text-sm text-muted-foreground">
            Connect external conferencing services so meeting types can create meetings on your behalf.
          </p>
        </header>

        {sp.zoom_connected && (
          <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
            Zoom connected. You can now pick Zoom as the conferencing provider on a meeting type.
          </div>
        )}
        {sp.zoom_error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Zoom connection failed: {sp.zoom_error}
          </div>
        )}

        <Card>
          <div className="flex items-start gap-4 p-4">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold">Zoom</p>
              {!zoomReady ? (
                <p className="text-xs text-muted-foreground">
                  Not configured on this server — set <code>ZOOM_CLIENT_ID</code> and <code>ZOOM_CLIENT_SECRET</code> in env.
                </p>
              ) : isConnected ? (
                <p className="text-xs text-muted-foreground">
                  Connected as <span className="font-mono">{ctx.host.zoomAccountEmail}</span>
                  {ctx.host.zoomConnectedAt ? ` · since ${ctx.host.zoomConnectedAt.toLocaleDateString("en-GB")}` : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not connected. Connecting lets meeting types create Zoom meetings on your account.
                </p>
              )}
            </div>
            {zoomReady && (
              isConnected ? (
                <ZoomDisconnectButton />
              ) : (
                <Link href="/api/oauth/zoom/start" className={buttonVariants()}>
                  Connect Zoom
                </Link>
              )
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-4 p-4 opacity-60">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold">Microsoft Teams</p>
              <p className="text-xs text-muted-foreground">Coming later.</p>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
