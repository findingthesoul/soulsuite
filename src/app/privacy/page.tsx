import Link from "next/link";

// Public privacy policy. Public URL because Zoom Marketplace, Google OAuth verification, and
// any future payment processor will require a hosted privacy policy URL. Kept simple and
// truthful — Soul Suite is a private collective tool, not a multi-tenant SaaS, so the policy
// reflects that scope.

export const metadata = {
  title: "Privacy Policy — Soul Suite",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-20 prose prose-sm dark:prose-invert">
        <p className="text-xs uppercase tracking-wide text-subtle-foreground">Soul Suite</p>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: 1 May 2026</p>

        <h2>Who we are</h2>
        <p>
          Soul Suite is a private scheduling tool operated by the Soul collective ({" "}
          <a href="https://soul.com" className="underline">soul.com</a>) for use by its members
          and the people they meet with. The data controller is Soul, contactable at{" "}
          <a href="mailto:support@soul.com" className="underline">support@soul.com</a>.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Host data (Soul members):</strong> name, email, profile fields you fill in
            (phone, location, bio, photo URL), timezone, working hours, a Google OAuth refresh
            token tied to your Google Calendar, and (optionally) a Zoom OAuth refresh token tied
            to your Zoom account.
          </li>
          <li>
            <strong>Invitee data (people who book with you):</strong> name and email at booking
            time, plus any answers to the intake questions the host configured. We do not collect
            anything from invitees beyond what they enter on the booking page.
          </li>
          <li>
            <strong>Calendar metadata:</strong> via Google Calendar&apos;s freebusy API we read
            time blocks marked busy on calendars the host has nominated as conflict sources. We
            do not read event titles, descriptions, attendees, or any other content.
          </li>
          <li>
            <strong>Zoom metadata:</strong> when a meeting type is configured to use Zoom, we
            create scheduled meetings on the host&apos;s Zoom account via Zoom&apos;s API. We store
            the resulting meeting ID + join URL on the booking row. We do not access recordings,
            transcripts, or chat.
          </li>
        </ul>

        <h2>Why we collect it</h2>
        <p>Three lawful bases under GDPR:</p>
        <ul>
          <li>
            <strong>Contract</strong> (Art. 6(1)(b)) — Soul members signed up to use the tool;
            we need their data to provide the service.
          </li>
          <li>
            <strong>Legitimate interest</strong> (Art. 6(1)(f)) — invitees ask to schedule a
            meeting with a member; processing their data is necessary to deliver that meeting.
          </li>
          <li>
            <strong>Consent</strong> (Art. 6(1)(a)) — for any optional data the user volunteers
            (e.g. profile bio, photo, intake answers).
          </li>
        </ul>

        <h2>Where it&apos;s stored</h2>
        <p>
          All data is stored in a Postgres database hosted by Supabase in the European Union
          (Frankfurt region). The application runs on Vercel. Email delivery uses Resend
          (US-based — relevant for international transfer; covered by Resend&apos;s Standard
          Contractual Clauses). Zoom and Google process data per their own privacy policies —
          consult those if relevant.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Host accounts: until the member leaves the workspace and we remove them.</li>
          <li>Bookings: kept indefinitely as historical records for the host. We aim to add an
            automatic 12-month retention sweep for invitee personal data on cancelled bookings.</li>
          <li>OAuth refresh tokens: kept as long as the host&apos;s account exists, deleted when
            they disconnect Google / Zoom or close their account.</li>
          <li>Intake answers: kept indefinitely today; auto-redact-after-90-days policy is on
            our roadmap.</li>
        </ul>

        <h2>Who we share it with</h2>
        <p>
          We do not sell or share your data with third parties for marketing. The processors
          we use to run the service:
        </p>
        <ul>
          <li>Supabase (database + auth) — EU region</li>
          <li>Vercel (hosting) — global edge, EU functions</li>
          <li>Google (calendar API + sign-in) — your own Google account</li>
          <li>Zoom (meeting API) — your own Zoom account</li>
          <li>Resend (transactional email) — US, covered by SCCs</li>
        </ul>

        <h2>Your rights (GDPR)</h2>
        <p>
          You can request access to, correction of, or deletion of your data by emailing{" "}
          <a href="mailto:support@soul.com" className="underline">support@soul.com</a>. We aim
          to respond within 30 days. If you&apos;re an invitee whose booking is over and you want
          your data scrubbed, the same email works.
        </p>

        <h2>Cookies</h2>
        <p>
          Soul Suite uses only essential cookies for the Supabase auth session. No tracking,
          no analytics cookies, no advertising cookies.
        </p>

        <h2>Zoom Marketplace integration</h2>
        <p>
          When a Soul Suite host connects their Zoom account, we use Zoom&apos;s OAuth to obtain a
          refresh token scoped to <code>meeting:write:meeting</code> and{" "}
          <code>user:read:user</code>. The refresh token is stored on the host&apos;s Soul Suite
          account row and used only to (a) confirm which Zoom email is connected, and (b)
          create / update / delete scheduled Zoom meetings when invitees book / reschedule /
          cancel via Soul Suite. Hosts can disconnect at any time at{" "}
          <Link href="/settings/connections" className="underline">/settings/connections</Link>;
          we then immediately delete the stored refresh token. We do not access recordings,
          transcripts, chat, or any data outside the meetings we create.
        </p>

        <h2>Changes</h2>
        <p>
          We&apos;ll update this page if we change anything material. The &quot;last updated&quot;
          date at the top is the source of truth.
        </p>

        <p className="text-sm text-muted-foreground">
          Questions? <a href="mailto:support@soul.com" className="underline">support@soul.com</a>
        </p>
      </div>
    </main>
  );
}
