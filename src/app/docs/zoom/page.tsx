import Link from "next/link";

// Public Zoom integration documentation. Hosted at /docs/zoom and submitted as the
// Documentation URL during Zoom Marketplace review. The required sections (Adding the App,
// Usage, Removing the App) follow Zoom's "common rejection issues — user documentation
// insufficient" guideline.

export const metadata = {
  title: "Zoom integration — Soul Suite",
};

export default function ZoomDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-20 prose prose-sm dark:prose-invert">
        <p className="text-xs uppercase tracking-wide text-subtle-foreground">Soul Suite</p>
        <h1 className="text-3xl font-semibold tracking-tight">Zoom integration</h1>
        <p className="text-sm text-muted-foreground">Last updated: 6 May 2026</p>

        <p>
          Soul Suite is a private scheduling tool for the Soul collective. Hosts can connect
          their Zoom account so that invitees who book a meeting type configured for Zoom get
          a Zoom meeting auto-created on the host&apos;s behalf. This page covers adding,
          using, and removing the integration.
        </p>

        <h2 id="adding">Adding the app</h2>
        <ol>
          <li>
            Sign in to Soul Suite at{" "}
            <a href="https://suite.soul.com" className="underline">suite.soul.com</a> with
            your Soul Google account.
          </li>
          <li>
            Open{" "}
            <Link href="/settings/connections" className="underline">Settings → Connections</Link>.
          </li>
          <li>
            Click <strong>Connect Zoom</strong>. You&apos;ll be redirected to Zoom&apos;s
            OAuth consent screen, which lists the permissions Soul Suite is requesting.
          </li>
          <li>
            Click <strong>Allow</strong>. Zoom redirects you back to Soul Suite, the
            connection is recorded, and the connections page now shows the connected Zoom
            account email and a <strong>Disconnect</strong> button.
          </li>
        </ol>
        <p>
          <strong>Permissions requested.</strong> Soul Suite uses the minimum scopes needed:
        </p>
        <ul>
          <li>
            <code>user:read:user</code> — read your Zoom user record on initial connect, so we
            can store the connected account email and confirm the OAuth grant succeeded.
          </li>
          <li>
            <code>meeting:read:meeting</code> — read meetings we created earlier, used by the
            reschedule path so we can confirm a meeting still exists before patching it.
          </li>
          <li>
            <code>meeting:write:meeting</code> — create scheduled meetings on your account
            when invitees book a Zoom-conferencing meeting type, and delete them when invitees
            cancel.
          </li>
          <li>
            <code>offline_access</code> — receive a refresh token so the integration keeps
            working without prompting you to reconnect every hour.
          </li>
        </ul>
        <p>
          We do not request permissions for recordings, transcripts, chat, webinars, account
          settings, dashboards, or anything administrative. If a future feature needs more, we
          will request that scope explicitly and re-prompt for consent.
        </p>

        <h3 id="troubleshooting-add">Troubleshooting</h3>
        <ul>
          <li>
            <strong>&quot;App not approved for your Zoom account&quot;</strong> — Soul Suite is
            currently distributed as an Unlisted app. If your Zoom account admin restricts
            third-party apps, ask them to allow <em>Soul Suite</em> in the Zoom admin console
            (<em>Account Management → App Marketplace → Permissions</em>).
          </li>
          <li>
            <strong>OAuth callback returns an error</strong> — sign out of Zoom in another
            tab, then retry. If it persists, contact{" "}
            <a href="mailto:support@soul.com" className="underline">support@soul.com</a>.
          </li>
          <li>
            <strong>You&apos;re prompted to reconnect</strong> — your refresh token was revoked
            (e.g. you disconnected from the Zoom side). Reconnect from{" "}
            <Link href="/settings/connections" className="underline">Settings → Connections</Link>.
          </li>
        </ul>

        <h2 id="usage">Usage</h2>
        <h3>Creating a Zoom meeting type</h3>
        <p>
          Once connected, edit any meeting type at{" "}
          <Link href="/dashboard/meeting-types" className="underline">Dashboard → Meeting types</Link>{" "}
          and set <strong>Conferencing</strong> to <em>Zoom</em>. Save. From that point on,
          every booking against that meeting type triggers a Zoom meeting creation under your
          connected Zoom account.
        </p>

        <h3>What happens on each booking</h3>
        <ol>
          <li>
            Invitee picks a slot on your public booking page and submits.
          </li>
          <li>
            Soul Suite calls Zoom&apos;s <code>POST /users/me/meetings</code> on your behalf
            with the booking&apos;s start time, duration, and meeting topic (the meeting type
            name).
          </li>
          <li>
            Soul Suite stores the resulting Zoom meeting id and join URL on the booking row.
          </li>
          <li>
            The invitee receives a confirmation email with the join URL. The same URL is
            placed on the Google Calendar event Soul Suite creates for you.
          </li>
        </ol>

        <h3>Cancellation</h3>
        <p>
          When the invitee or host cancels the booking, Soul Suite calls{" "}
          <code>DELETE /meetings/&#123;id&#125;</code> to remove the corresponding Zoom
          meeting. If the call fails (network error, Zoom outage), the booking is still
          marked cancelled and the Zoom-side meeting can be removed manually later.
        </p>

        <h3>Reschedule</h3>
        <p>
          A reschedule deletes the original Zoom meeting and creates a new one at the new
          time. The invitee receives an updated email with the new join URL.
        </p>

        <h3>Collective routing</h3>
        <p>
          When a meeting type uses <em>collective</em> routing (multiple hosts attend the same
          meeting), the meeting is created on the configured conferencing host&apos;s Zoom
          account; the other hosts are added as alternative hosts on the Zoom meeting and as
          attendees on the Google Calendar event.
        </p>

        <h3>What we do not do</h3>
        <ul>
          <li>We do not access Zoom recordings or transcripts.</li>
          <li>We do not access Zoom chat messages.</li>
          <li>We do not modify Zoom user settings, account settings, or webinar configuration.</li>
          <li>We do not list, read, or modify meetings other than those Soul Suite created.</li>
        </ul>

        <h2 id="removing">Removing the app</h2>
        <p>You can remove the integration in two equivalent ways:</p>

        <h3>From Soul Suite</h3>
        <ol>
          <li>
            Go to{" "}
            <Link href="/settings/connections" className="underline">Settings → Connections</Link>.
          </li>
          <li>
            Click <strong>Disconnect</strong> next to your connected Zoom account.
          </li>
        </ol>

        <h3>From Zoom</h3>
        <ol>
          <li>
            Sign in to{" "}
            <a href="https://marketplace.zoom.us" className="underline" target="_blank" rel="noopener noreferrer">
              marketplace.zoom.us
            </a>.
          </li>
          <li>Click your avatar → <em>Manage</em> → <em>Added Apps</em>.</li>
          <li>Find <strong>Soul Suite</strong> and click <em>Remove</em>.</li>
        </ol>
        <p>
          Either path triggers the same outcome: Zoom revokes the OAuth grant and Soul Suite
          stops being able to call Zoom on your behalf.
        </p>

        <h3>What happens when you disconnect</h3>
        <ul>
          <li>
            <strong>Refresh token deleted.</strong> The OAuth refresh token Soul Suite stored
            for your account is removed from our database immediately. We can no longer create,
            modify, or delete Zoom meetings on your behalf.
          </li>
          <li>
            <strong>Connected-account email cleared.</strong> The Zoom account email shown on
            your connections page is wiped.
          </li>
          <li>
            <strong>Existing bookings keep their join URLs.</strong> Bookings that were created
            while you were connected still have their Zoom meeting IDs and join URLs stored on
            the booking row, so the Zoom meetings created in the past remain joinable until they
            occur. You can manually delete those meetings from your Zoom account if needed.
          </li>
          <li>
            <strong>Future Zoom-conferencing bookings will fail to create a meeting</strong>{" "}
            until you reconnect. Soul Suite still accepts the booking; the invitee just
            doesn&apos;t get a Zoom join URL on their confirmation. Switch the meeting type to
            another conferencing provider (Google Meet / In person / None) if you don&apos;t
            plan to reconnect.
          </li>
          <li>
            <strong>Webhook receipts.</strong> Zoom sends a {`"deauthorization"`} event to
            Soul Suite. We log it and confirm receipt; no further action is needed.
          </li>
        </ul>

        <h3>Data deletion request</h3>
        <p>
          To remove all Zoom-related data we&apos;ve stored — including past booking rows&apos;
          Zoom meeting IDs and join URLs — email{" "}
          <a href="mailto:support@soul.com" className="underline">support@soul.com</a>. We
          aim to action within 30 days, in line with our{" "}
          <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>

        <p className="text-sm text-muted-foreground">
          Questions? <a href="mailto:support@soul.com" className="underline">support@soul.com</a>
        </p>
      </div>
    </main>
  );
}
