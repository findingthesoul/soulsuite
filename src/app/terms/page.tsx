// Public terms of service. Required by Zoom Marketplace + Google OAuth verification + future
// payment processors. Soul Suite is a private tool; the terms reflect that scope (no
// commercial offering, no payment, internal collective use).

export const metadata = {
  title: "Terms of Service — Soul Suite",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-20 prose prose-sm dark:prose-invert">
        <p className="text-xs uppercase tracking-wide text-subtle-foreground">Soul Suite</p>
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated: 1 May 2026</p>

        <h2>What this is</h2>
        <p>
          Soul Suite is a private scheduling tool operated by the Soul collective for use by
          its members and the people who book meetings with them. It is not offered as a
          public product. Use is by invitation only.
        </p>

        <h2>Eligibility</h2>
        <p>
          You may use Soul Suite if (a) you are a Soul collective member with a verified
          @soul.com Google account, or (b) you have been invited to a specific Team or to
          book a specific meeting type. By signing in or booking, you confirm you are at least
          16 years old.
        </p>

        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the service to send spam, phishing, or unlawful communications.</li>
          <li>Attempt to circumvent access controls, authentication, or rate limits.</li>
          <li>Reverse-engineer, scrape, or interfere with the service.</li>
          <li>Upload anything that infringes intellectual property or violates law.</li>
        </ul>

        <h2>Your data</h2>
        <p>
          See our <a href="/privacy" className="underline">Privacy Policy</a> for what we
          collect, why, where it&apos;s stored, and how you can request access or deletion.
        </p>

        <h2>Third-party integrations</h2>
        <p>
          Soul Suite integrates with Google Calendar, Google Meet, Zoom, and Resend. Your use
          of those services is governed by their own terms and privacy policies. Soul Suite
          stores OAuth refresh tokens in order to call those services on your behalf when you
          configure a meeting type to use them.
        </p>

        <h2>Availability</h2>
        <p>
          We make no SLA commitment. The service is provided &quot;as is&quot;, without warranty
          of any kind. We reserve the right to take it offline for maintenance or to retire
          it entirely with reasonable notice to active users.
        </p>

        <h2>Liability</h2>
        <p>
          To the maximum extent permitted by law, Soul, its members, and its contributors are
          not liable for indirect, incidental, special, consequential, or punitive damages
          arising from use of the service, including missed meetings, calendar errors, or
          delivery failures of email or video links. Total aggregate liability is capped at
          €100.
        </p>

        <h2>Termination</h2>
        <p>
          You may stop using the service at any time. We may suspend or terminate your access
          if you breach these terms. On termination we delete your stored OAuth tokens and
          host record on request — see the Privacy Policy.
        </p>

        <h2>Changes</h2>
        <p>
          Material changes will be communicated via in-app notice or email. Continued use after
          changes take effect constitutes acceptance.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of the Netherlands. Disputes will be resolved
          in the courts of Amsterdam, NL.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:support@soul.com" className="underline">support@soul.com</a>
        </p>
      </div>
    </main>
  );
}
