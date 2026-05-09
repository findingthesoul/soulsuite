import { getPageContextOrRedirect, shellProps } from "@/lib/page-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const EVENT_TYPES: { id: string; title: string; lives: string; body: string; example: string }[] = [
  {
    id: "one-on-one",
    title: "One-on-one",
    lives: "Personal or Team",
    body: "A single host meets a single invitee. The booking page offers slots from the host's working hours, filtered by their connected calendars. This is the default for almost every personal scheduling link.",
    example: "Sjoerd shares a 30-minute discovery call link from his personal page; one prospect picks a slot.",
  },
  {
    id: "group",
    title: "Group",
    lives: "Personal or Team",
    body: "One host hosts multiple invitees in the same slot, up to a configurable cap. Each invitee books independently; the slot stays open until the cap is reached, then disappears.",
    example: "Remco runs a monthly office-hours session capped at 8 people; invitees self-serve into a single Friday hour.",
  },
  {
    id: "round-robin",
    title: "Round robin",
    lives: "Team only",
    body: "Several hosts share a link; each booking is assigned to one of them. The default fairness rule is least-recently-assigned, so work spreads evenly across the team. Only one host attends per booking.",
    example: "The Soul sales team publishes a single intro-call link. The next call goes to whichever host has waited longest since their last assignment.",
  },
  {
    id: "collective",
    title: "Collective",
    lives: "Team only",
    body: "Several hosts must all be free at the same time, and all of them attend together. The booking page only offers the intersection of every host's availability, so slots are scarcer than for round robin.",
    example: "A pitch with one invitee where both Sjoerd and Remco need to be in the room. The booker only sees times that work for both.",
  },
  {
    id: "one-off",
    title: "One-off meeting",
    lives: "Personal or Team",
    body: "Instead of opening up working hours, the host hand-picks a few specific times and shares those. Useful when the meeting falls outside normal hours or when you want to constrain choice tightly.",
    example: "Sjoerd offers a guest three 45-minute slots next Tuesday evening — outside his normal working hours, just for this conversation.",
  },
  {
    id: "meeting-poll",
    title: "Meeting poll",
    lives: "Personal or Team",
    body: "The host proposes several candidate slots and the invitees vote (yes / maybe / no). Once enough votes are in, the host finalises one option and Soul Suite turns it into a real booking with a calendar event.",
    example: "Five Soul members need to find an hour together next week; the host posts six candidate times and lets people vote before locking it in.",
  },
];

export default async function SupportPage() {
  const ctx = await getPageContextOrRedirect();

  return (
    <AppShell {...shellProps(ctx)}>
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
          <p className="text-sm text-muted-foreground">
            A short tour of the scheduling types Soul Suite supports and how the Workspace, Teams and Personal layers fit
            together. Still stuck? Email{" "}
            <a className="underline hover:text-foreground" href="mailto:support@soul.com">
              support@soul.com
            </a>
            .
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 pt-2 text-sm">
            <a className="text-muted-foreground hover:text-foreground underline" href="#event-types">
              Event types
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#how-it-works">
              Workspace, Teams, Personal
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#availability">
              Availability
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#conferencing">
              Conferencing
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#payments">
              Payments
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#polls">
              Polls
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#contacts">
              Contacts
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#public-pages">
              Public pages
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#mobile">
              Mobile / Install
            </a>
          </nav>
        </header>

        <section id="event-types" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Event types explained</h2>
          <div className="space-y-3">
            {EVENT_TYPES.map((t) => (
              <Card key={t.id} id={t.id} className="scroll-mt-8">
                <CardHeader>
                  <div className="flex items-baseline justify-between gap-3">
                    <CardTitle>{t.title}</CardTitle>
                    <span className="text-xs text-subtle-foreground">{t.lives}</span>
                  </div>
                  <CardDescription>{t.body}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">For example.</span> {t.example}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">How scheduling and Teams work</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Soul Suite has three layers: <span className="text-foreground">Workspace</span>,{" "}
                <span className="text-foreground">Teams</span>, and <span className="text-foreground">Personal</span>. The
                Workspace is Soul itself — one tenant containing every host. Teams group a subset of hosts (and sometimes
                external collaborators) around a shared piece of work. Personal is your own bookable surface, owned only
                by you.
              </p>
              <p>
                Personal meeting types live under your own slug, e.g. <code>/sjoerd/intro</code>. They use your working
                hours, your connected calendars, and only you can host them. Editing, pausing or deleting them is entirely
                up to you — no one else in the workspace can change your personal links.
              </p>
              <p>
                Team meeting types live under a Team slug, e.g. <code>/growth/discovery</code>, and are owned by the team
                rather than any one host. When you create one you choose a routing mode: <span className="text-foreground">single</span>{" "}
                (one named host always takes it), <span className="text-foreground">round robin</span> (the team rotates,
                least-recently-assigned wins), or <span className="text-foreground">collective</span> (every assigned host
                must be free and all attend).
              </p>
              <p>
                Availability for team meeting types comes from the assigned hosts' personal working hours and connected
                calendars. Round-robin links offer the union of everyone's free slots; collective links offer only the
                intersection. That's why collective meetings are harder to book — you're asking several calendars to line
                up at once.
              </p>
              <p>
                Members are tracked at every layer. <span className="text-foreground">Workspace members</span> are anyone
                with a Soul Suite account in the workspace, with a role of Owner, Admin or Member. Owners and Admins manage
                workspace branding, members and the global member list; everyone else just signs in and works.
              </p>
              <p>
                <span className="text-foreground">Team members</span> are added per team. Soul-internal hosts can be added
                directly. External collaborators (guests outside @soul.com) only see the teams they were invited to — they
                never see the wider workspace. A team member can be a Lead (manages the team and its meeting types) or a
                regular member (hosts bookings but doesn't change settings).
              </p>
              <p>
                <span className="text-foreground">Invites</span> work the same way at both layers: the inviter picks an
                email and a role; the recipient gets a tokenised link; on first sign-in the invite is accepted
                automatically and the right membership row is created. Workspace invites give people access to the whole
                workspace; team invites give them access to one team only.
              </p>
              <p>
                When in doubt, the rule of thumb is: <span className="text-foreground">Personal</span> is for things only
                you host, <span className="text-foreground">Teams</span> is for things the group hosts together, and the{" "}
                <span className="text-foreground">Workspace</span> is the container that holds it all. Branding,
                domain-based sign-in, and the global member list live at the workspace level; everything else lives in a
                team or on a person.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="availability" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Availability</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Your availability is layered. The default is your <span className="text-foreground">personal working hours</span> at{" "}
                <code>/settings/availability</code> — a weekly grid + timezone that applies to every meeting type you host
                unless you override it.
              </p>
              <p>
                Each meeting type can <span className="text-foreground">override your default</span> on its own Availability
                tab. Useful for things like &quot;I&apos;ll only take intro calls Friday afternoons&quot; while leaving the rest of
                your hours as-is.
              </p>
              <p>
                On a Team, you can set <span className="text-foreground">per-team working hours</span> per host (open the
                team detail page → click the host&apos;s &quot;Hours&quot; link). E.g. if you work different hours for the Acme
                project than for everything else.
              </p>
              <p>
                Order of precedence when computing slots: per-MT override → per-team override → personal default. Your
                connected Google calendars (under <code>/onboarding/calendars</code>) block availability when busy.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="conferencing" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Conferencing</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Each meeting type picks one provider: <span className="text-foreground">Google Meet</span> (free, uses your
                Google calendar), <span className="text-foreground">Zoom</span> (per-host OAuth at{" "}
                <code>/settings/connections</code>), <span className="text-foreground">Microsoft Teams</span> (coming),{" "}
                <span className="text-foreground">In person</span> — sets a fixed location on the calendar event;
                no online link generated, <span className="text-foreground">Personal room</span> — uses your fixed
                meeting URL (e.g. your Zoom Personal Meeting Room or a permanent Whereby room). Set the URL once on
                your profile; every booking hands it to the invitee. No per-booking provider API calls. Or{" "}
                <span className="text-foreground">None</span> (no link generated).
              </p>
              <p id="alternative-location" className="scroll-mt-8">
                <span className="text-foreground font-medium">Alternative location:</span> any individual booking can
                be given a per-booking location override from <code>/dashboard/bookings</code>. Useful when an
                auto-generated Zoom didn&apos;t happen — paste a manual Zoom link there — or to change a venue
                last-minute. The override applies to the calendar event and the public confirmed page; the invitee
                gets a brief notification email. Setting it back to empty reverts to the provider-generated value.
              </p>
              <p>
                For <span className="text-foreground">Collective</span> meeting types, you pick one host&apos;s account to
                provide the meeting link. Only that host needs the provider connected — others are added as alternative
                hosts (same Zoom org) or guests via the calendar invite (cross-org).
              </p>
              <p>
                Connection issues self-heal: if your Zoom token is revoked, the connections page shows a &quot;Connection
                expired&quot; banner naming your previously-connected account. Click Connect Zoom to reconnect.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="payments" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Payments</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Meeting types can be <span className="text-foreground">free</span> or <span className="text-foreground">paid</span>.
                Connect your Stripe account at <code>/settings/payments</code> by pasting your Stripe account ID
                (starts with <code>acct_</code>). Each host has their own Stripe account — payments go straight to you.
              </p>
              <p>
                On a paid meeting type, set the price + currency on the Pricing tab and pick a method:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="text-foreground">Stripe</span> — invitee pays online via Stripe Checkout before the
                  booking finalises. Confirmation email + calendar invite go out after payment.
                </li>
                <li>
                  <span className="text-foreground">Pay by invoice</span> — invitee fills in billing details (company,
                  address, VAT, PO ref) at booking time. Booking is confirmed without payment; you send the invoice
                  externally and mark it paid in <code>/dashboard/payments</code>.
                </li>
              </ul>
              <p>
                <code>/dashboard/payments</code> shows all your paid bookings with filters (Failed-to-finalize,
                Invoice pending, Refunded, Healthy). Failed bookings get <span className="text-foreground">Retry</span>{" "}
                (re-run finalisation) and <span className="text-foreground">Refund</span> (full Stripe refund) buttons —
                customers who paid for a meeting that didn&apos;t materialise can be made whole in two clicks.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="polls" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Polls</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                When you don&apos;t want a fixed link but rather to ask &quot;which of these times works?&quot; — create a Meeting
                Poll at <code>/dashboard/polls/new</code>. Pick a few candidate slots, add invitees by email, send.
                Each invitee gets a vote link.
              </p>
              <p>
                Polls can be <span className="text-foreground">Personal</span> or <span className="text-foreground">Team</span>{" "}
                scoped (lead-only on the team scope). Once the winning slot is clear, finalise the poll — Soul Suite
                creates the booking, calendar event, and confirmation emails for everyone.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="contacts" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Contacts</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Every booking auto-populates the Contacts directory at <code>/dashboard/contacts</code> — name + email
                from the booking. You can manually add phone, company, job title, LinkedIn URL, location, and timezone on
                the contact detail page.
              </p>
              <p>
                Past + upcoming meetings show on each contact&apos;s detail page. Names from booking-time can be edited if
                an invitee made a typo — the upsert-on-booking won&apos;t overwrite admin-edited names.
              </p>
              <p>
                Contacts are workspace-scoped (everyone in the workspace shares the directory).
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="public-pages" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Public pages</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Two public surfaces, no login required:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code>/{"<your-slug>"}</code> — your personal page listing every active personal meeting type. Like a
                  public profile + booking directory in one.
                </li>
                <li>
                  <code>/{"<team-slug>"}</code> — the team&apos;s page listing every active team meeting type.
                </li>
                <li>
                  <code>/{"<slug>"}/{"<mt-slug>"}</code> — the actual booking page for a single meeting type.
                </li>
              </ul>
              <p>
                Workspace branding (logo + colour) automatically applies to all public pages. One-off meeting types are
                hidden from the directory pages by design — they&apos;re for direct one-shot shares.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="mobile" className="space-y-3 scroll-mt-8">
          <h2 className="text-xs uppercase tracking-wide text-subtle-foreground">Mobile / install</h2>
          <Card>
            <CardContent className="pt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Soul Suite is a Progressive Web App — installable on iOS and Android home screens with no app-store
                detour:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="text-foreground">iOS Safari</span>: tap the share icon → &quot;Add to Home Screen&quot;.
                </li>
                <li>
                  <span className="text-foreground">Android Chrome</span>: an install prompt appears automatically; or
                  tap the menu → &quot;Install app&quot;.
                </li>
              </ul>
              <p>
                Once installed, the app launches full-screen with a bottom navigation bar (Home, Bookings, Personal,
                Teams, More) — same five sections as the desktop sidebar.
              </p>
              <p>
                The user menu (theme toggle, sign-out, profile, settings, tour) stays in the top-right header on every
                screen size.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
