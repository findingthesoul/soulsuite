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
          <nav className="flex gap-4 pt-2 text-sm">
            <a className="text-muted-foreground hover:text-foreground underline" href="#event-types">
              Event types
            </a>
            <a className="text-muted-foreground hover:text-foreground underline" href="#how-it-works">
              How scheduling and Teams work
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
      </div>
    </AppShell>
  );
}
