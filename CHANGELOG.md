# Changelog

Notable shipped changes per version. Newest first. The version on `main` matches `package.json` at the time of merge.

## 1.0.0 — Launch 🚀
The Soul Suite v1 cut. Everything in the brief, plus the user-requested polish since.

### Scheduling
- Three-layer model: Workspace → Teams → Personal
- Event types: One-on-one, Group, Round-robin (with per-team fairness rule), Collective, One-off, Polls
- Per-meeting-type availability override
- Per-host-per-project working hours override
- In-person conferencing with default location
- Per-booking alternative location override (paste a manual link or address; calendar event patches in place; invitee gets a brief notification email)

### Conferencing
- Google Meet (auto-generated)
- Zoom (per-host OAuth, alternative-host fallback for cross-org Collective bookings)
- Microsoft Teams (branch ready, awaiting Azure AD app registration)
- Collective conferencing host (only one host needs the provider connected; others added as alternative hosts/guests)
- None
- Auto-clear revoked tokens + reconnect banner

### Payments
- Stripe live + test, per-host accounts via Stripe Connect direct charges
- Pay by invoice (billing details captured at booking time, host invoices externally, mark as invoiced/paid in admin)
- Adyen placeholder ("coming")
- Admin retry + refund for paid bookings whose finalize step failed
- Payment pill on every booking row (Paid / Invoice pending|sent|paid / Refunded / Failed)

### UX
- Direct-edit forms with sticky SaveBar + dirty-nav guard
- Tabs on MT edit forms (Basics, Routing, Availability, Conferencing, Pricing, Intake)
- Public landing pages: `/<host-slug>` and `/<project-slug>`
- Home dashboard: Quick links section (top 3 most-booked MTs)
- Bookings: list / week / month views, scope dropdown, payment pill
- Contacts directory (auto-built from booking history, manually editable)
- Help page covering every feature

### Mobile / PWA
- Installable on iOS + Android home screens
- Service worker, manifest, offline shell
- Bottom nav (Home / Bookings / Personal / Teams / More)
- Stacked tables on mobile for payments
- Safe-area-aware on iOS

### Operations
- GDPR SAR export
- Migrations auto-applied on every Vercel build
- Single email per booking (Resend confirmation only; Google calendar updates silently)

### Open product decisions still on defaults
- Shared dashboard (vs per-host)
- Round-robin fairness: LEAST_RECENTLY_ASSIGNED (configurable per team)
- Poll vote visibility: visible to other invitees

---

## 0.52.0 — In-person + alternative location
- IN_PERSON conferencing with required `defaultLocation`
- Per-booking `alternativeLocation` override (host-only)
- Calendar event location patched in place; invitee notification email
- Help page expanded with full feature overview
- Bookings: scope filter as dropdown (compact for many teams)
- Payment pill on booking rows

## 0.51.0 — Mobile bottom nav
- Fixed bottom navigation bar (mobile only) with Home / Bookings / Personal / Teams / More
- "More" bottom-sheet for the rest
- Payments table → stacked cards on mobile
- Old hamburger drawer removed

## 0.50.0 — PWA
- Installable web app (manifest, service worker, icons)
- iOS + Android install support, full-screen launch
- Mobile responsive polish

## 0.49.0 — Pay by invoice
- New PaymentMethod enum (STRIPE / INVOICE / ADYEN-soon)
- Multi-step booking flow with billing-details step for invoice MTs
- INVOICE_PENDING / INVOICE_SENT / PAID lifecycle
- Mark-as-invoiced + Mark-as-paid admin actions

## 0.48.0 — Admin retry + refund
- /dashboard/payments admin page
- Retry button: re-run finalize on bookings whose Zoom/Google failed
- Refund button: full Stripe refund via Connect direct charge

## 0.47.0 — Tabs UI on MT forms
- 5 tabs (personal) / 6 tabs (project): Basics, Routing, Availability, Conferencing, Pricing, Intake
- Tab error badges that auto-switch on save failure

## 0.46.0 — Round-robin fairness per-team + Stripe + leftovers
- `Project.roundRobinFairness` enum (LEAST_RECENTLY_ASSIGNED / LEAST_LOADED / STRICT_ROTATION / RANDOM)
- Stripe payments per host (live + test)
- Hide Group bookings card when not Single
- "with X / X and Y / X or Y" formatting on public booking page

## 0.42.0 — public pages + home quick links
- Public landing page at `/<host-slug>` listing all active personal MTs (cal.com-style directory).
- Public landing page at `/<project-slug>` for team MTs.
- Home dashboard: "Quick links" section showing top 3 most-booked MTs with copy/open buttons.

## 0.41.0 — home quick links (sub-feature)
- Most-booked MT ranking by 90-day booking count.

## 0.40.0 — public host/project pages (sub-feature)
- Server-rendered, no auth, workspace-branded.

## 0.39.0 — collective conferencing host
- For Collective MTs: pick which assigned host's account creates the Zoom/Meet meeting. Only that host needs the provider connected; others get added as Zoom alternative hosts (same org) or fall back to calendar-invite guests (cross-org).
- New `MeetingType.conferencingHostId` field. UI picker shown only when routing is Collective + provider isn't NONE.
- Build script now runs `prisma migrate deploy` automatically on Vercel.

## 0.38.0 — collective conferencing host (sub)

## 0.37.0 — contacts + project working hours + UI polish
- **Contact directory** at `/dashboard/contacts` (auto-built from booking history; manually editable phone/company/title/LinkedIn/location/timezone).
- **Per-host-per-project working hours** override. Engine precedence: per-MT override → per-project override → host default.
- Breadcrumbs on MT edit pages: `Personal > <name>` and `Teams > <project> > <name>`.
- Copy + Open booking-link buttons on MT edit pages.
- Teams "New" menu now also enables One-on-one and Group (a project can have single-host MTs).
- DirtyNavGuard: warns with Save/Cancel modal when leaving an unsaved form.
- Removed duplicate "New one-off" button on Personal.
- Routing mode badge (Single / Round-robin / Collective / Group) on team MT rows.
- Sidebar reorganised: "You" section (Availability) always visible; "Workspace" section (Internal, Contacts) gated on workspace membership.
- Sign-out fix (Radix DropdownMenuItem was swallowing the form submit).

## 0.36.0 — project working hours override (sub)
## 0.35.0 — contact directory (sub)

## 0.34.0 — direct-edit forms + per-MT availability + account chooser + polls
- **Direct-edit pattern** rolled out across all settings forms (no more Edit/Save/Cancel toggle; sticky SaveBar in top-right).
- **Per-meeting-type working hours override** (`MeetingType.workingHoursOverride`).
- Google sign-in now uses `prompt: select_account consent` so the account chooser appears every time.
- **Project-scoped polls** (LEAD-only).

## 0.33.0 — GDPR SAR export
- `/api/admin/sar-export` endpoint + `scripts/sar-export.ts` for Subject Access Requests.

## 0.29.0 — Zoom Marketplace submission
- `/privacy` and `/terms` public pages with Zoom-specific privacy section.
- Listing copy + scope justifications + test instructions in `docs/ZOOM_MARKETPLACE_SUBMISSION.md`.

## 0.28.0 — direct-edit pilot
- Pilot on `/settings/profile` and `/settings/branding`.
- New `useDirtyState` hook + `<SaveBar>` primitive.

## 0.27.0 — team-add modal UX
- Searchable internal-team picker + invite-by-email tabs.
- Hand-rolled Dialog primitive (no Radix dep).

## 0.25.0 — naming cleanup
- "Members" → "Internal team" (workspace) vs "Team members" (project).
- Internal vs External member distinction surfaced.

## 0.24.0 — Suspense streaming
- Bookings dashboard streams sections independently.

## 0.23.0 — router cache + indexes
- 30s router-cache stale time. `Invite.expiresAt` index.

## 0.22.0 — hover prefetch
- Booking rows prefetch the public confirmation page on hover.

## 0.21.0 — perf round 5
- Per-request auth memo via React `cache()`. More loading skeletons.

## 0.20.0 — persist view prefs
- Bookings view + filters persisted across sessions.

## 0.19.0 — perf round 4 (Zoom + skeletons)
- In-memory Zoom token cache + per-host coalesced rotation.
- Loading skeletons across dashboard routes.

## 0.18.0 — cache page-context
- `unstable_cache`-wrapped workspace lookup behind `getPageContextOrRedirect`.

## 0.17.0 — perf round 1
- Skip session refresh on public paths. Parallelise freebusy. Per-host freebusy cache. Hot-path indexes.

## 0.16.0 — polls
- Personal-only meeting polls (Step 11).

---

## Pre-0.16 highlights (build steps)
- Step 1: auth + workspace bootstrap + Google calendar picker
- Step 2: single-host meeting type + availability engine + booking flow
- Steps 3–10: round-robin, collective routing, group meetings, one-off slots, intake forms, conferencing providers (Google Meet + Zoom), email confirmations (Resend), reschedule/cancel
- Step 12: email confirmations (booking + cancel + reschedule + poll invite)
