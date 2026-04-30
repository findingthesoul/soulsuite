# Performance & GDPR Audit — Soul Suite

Snapshot date: 2026-04-30. Branch: `docs/perf-gdpr-audit`. Scope: read-only audit of
`prisma/schema.prisma`, `src/lib/**`, `src/app/api/**`, `src/middleware.ts`, and the
dashboard server pages. No code changes; everything below is a punch list to triage.

Effort tags: **S** ≤ half a day, **M** ≤ 2 days, **L** > 2 days or needs design.

---

## 1. Performance findings

Ordered roughly by impact × frequency on the booking hot path.

### P1. Sequential per-host freebusy in round-robin booking — **M**
- File: `src/app/api/bookings/route.ts` lines 89–119.
- The `for (const cand of candidateHosts)` loop awaits `fetchHostBusy` and
  `computeAvailableSlots` serially. With N candidates this is O(N) round trips to
  Google before we even create the row.
- Fix: `Promise.all(candidateHosts.map(...))` and short-circuit inside the map; the
  fairness pick happens after, so order is irrelevant.

### P2. Round-robin slot computation runs N freebusy calls in parallel but uncached — **M**
- File: `src/lib/round-robin.ts` lines 25–32 and `src/lib/availability/freebusy.ts`
  lines 39–65.
- Every public booking page render fans out one freebusy call per project member
  (`computeRoundRobinSlots`). For a 4-person team that's 4 Google round-trips on every
  unauth'd page hit — easy DoS amplifier and wastes Google quota (~500 req/100 sec/user).
- Fix: add the 60-second per-host freebusy cache the brief §"Rate limits" already
  flags. Key on `(hostId, conflictCalendarIds, range bucket)`. Use `unstable_cache` or
  a tiny in-process LRU; bust on booking write.

### P3. Public booking page is fully dynamic and uncached — **M**
- File: `src/app/[slug]/[meetingTypeSlug]/page.tsx` lines 28–50.
- Calls `getAvailableSlotsForMeetingType` synchronously on every render; there is no
  `revalidate` or `unstable_cache`. A scraper or impatient invitee mashing refresh
  walks straight through to Google.
- Fix: wrap with `unstable_cache` keyed on (hostId, meetingTypeId, range bucket) for
  60 s; or set `export const revalidate = 60`. Combine with P2.

### P4. `prisma.workspaceMember.findFirst` runs on every authenticated request — **S**
- File: `src/lib/page-context.ts` lines 23–30.
- `getPageContextOrRedirect` is called in every server page; the workspace lookup is
  not cached even though brand colour and logo change rarely.
- Fix: wrap in `unstable_cache(['workspace-for-host', hostId], …, { revalidate: 60 })`
  and bust from the workspace settings POST handler.

### P5. Bookings list query has no useful index for `(hostId, startsAt, status)` — **S**
- File: `prisma/schema.prisma` line 281 vs. usage in
  `src/app/dashboard/page.tsx` lines 19–48 and `src/app/dashboard/bookings/page.tsx`
  lines 56–70.
- Existing index is `@@index([hostId, startsAt])`. Dashboard filters
  `status: { not: "CANCELLED" }`. With many cancellations this still bench-scans the
  hostId+startsAt slice. Bookings list adds `projectId` filter against
  `@@index([projectId])` only — won't combine.
- Fix: add `@@index([hostId, status, startsAt])` and
  `@@index([hostId, projectId, startsAt])`.

### P6. Booking dashboard page returns up to 1000 rows in week/month views — **S**
- File: `src/app/dashboard/bookings/page.tsx` line 69 (`take: view === "list" ? 200 : 1000`).
- Even a moderately busy host blows the payload past 100 KB and hydrates 1k rows for
  a 6-week month view. No pagination.
- Fix: drop `take` for date-bounded queries (gte/lt already cap it) and add a
  `take: 50` + cursor pagination on the list view. Server-render only the visible
  list slice.

### P7. `Booking.requestId` deterministic key allows replay across sessions — discussed in P10/G7; perf-relevant note — **S**
- File: `src/app/api/bookings/route.ts` lines 151–155.
- Duplicate-booking attempts trigger a P2002 plus a follow-up `findUnique` on
  `requestId`. Fine functionally; just note it's the second DB round-trip on retries
  — keep an eye on it if booking volume grows.

### P8. Reschedule does an extra `prisma.project.findUnique` after the write — **S**
- File: `src/app/api/bookings/[id]/reschedule/route.ts` lines 136–141.
- Could be loaded in the original `findUnique` at line 31 via
  `include: { meetingType: { include: { project: { select: { slug: true } } } } }`.
- Fix: include the project slug up front; remove the second query.

### P9. Cancel route does an extra `findFirst` for the write-target calendar — **S**
- File: `src/app/api/bookings/[id]/cancel/route.ts` lines 31–33.
- The initial `findUnique` at line 17 already includes `host`; just include
  `host: { include: { calendars: { where: { role: "WRITE_TARGET" } } } }`.

### P10. `getZoomAccessTokenForHost` always rotates the refresh token — **M**
- File: `src/lib/zoom/host.ts` lines 9–22.
- Every call hits Zoom's token endpoint and writes back to Postgres, even for a
  rapid sequence of calls (booking flow can hit this twice: create, then cancel-on-
  failure path). Race two concurrent bookings on the same host and you get two
  parallel rotations — last write wins, the other refresh token is invalidated.
- Fix: cache the access token in-process with TTL ~ `expires_in - 60s`; serialise
  rotations per-host with a simple promise map.

### P11. Booking POST does sequential `prisma.host.update` after Google failure — **S**
- File: `src/app/api/bookings/route.ts` lines 250–266.
- Three sequential awaits (`booking.update`, then `projectMember.update`) on the
  happy path. Wrap them in `prisma.$transaction([…])` or `Promise.all` since they
  touch different rows.

### P12. `googleRefreshToken` invalidation writes are not transactional — **S**
- Multiple sites: `src/app/api/bookings/route.ts` line 98, line 269; reschedule line
  61; cancel line 43.
- A failed Google call can race with another active booking that already started a
  Google call with the same (still valid) token; we'd null out a working token. Low
  probability but worth a `where: { id, googleRefreshToken: <captured> }` guard.

### P13. Dashboard polls list — no index on `(ownerHostId, status)` — **S**
- File: `src/app/dashboard/page.tsx` lines 43–47 vs. `prisma/schema.prisma` line 318.
- Index is on `hostId`, not `ownerHostId`. Add `@@index([ownerHostId, status])`.

### P14. `Invite.token` is the only lookup path but `Invite.expiresAt` cleanup is manual — **S**
- File: `prisma/schema.prisma` lines 359–380.
- No index on `expiresAt`. A future cron sweep `deleteMany({ where: { expiresAt: { lt: now } } })`
  will table-scan. Add `@@index([expiresAt])`.

### P15. Middleware runs Supabase `getUser` on EVERY request — **M**
- File: `src/middleware.ts` lines 10–32.
- Includes static-ish routes (e.g. `/poll/respond/<token>` GET, all public
  `/{slug}/{mt}` pages). Each call is at minimum a JWT verify, often a network call
  to Supabase to refresh the access token.
- Fix: tighten the matcher to skip public unauth paths (`/^/(?!auth|dashboard|settings|onboarding|api/(?!polls/respond)).*/`)
  or short-circuit on missing access-token cookie.

### P16. Public booking page (`/[slug]/[meetingTypeSlug]`) is not edge-runtime eligible but could be — **M**
- File: `src/app/[slug]/[meetingTypeSlug]/page.tsx`.
- Uses Prisma + `googleapis` (Node-only). Splitting the slot fetch into a route
  handler that is incrementally cached (`unstable_cache`) and rendering the shell
  statically would let Vercel serve from edge cache on cold hits.
- Fix bundles with P3.

### P17. No image optimisation on `Workspace.logoUrl` — **S**
- File: `src/components/app-shell.tsx` (uses raw `<img>` based on the brief).
- Workspace logos rendered with a plain tag; missing `next/image` means no
  width/height inferral, no responsive `srcset`, no LCP optimisation.
- Fix: switch to `<Image>` and add the logo host to `next.config.ts` `images.remotePatterns`.

### P18. `prisma/schema.prisma` `Booking.meetingType` has no `onDelete` — **S**
- Lines 276–278: `meetingType`, `host`, `project` relations omit cascade.
- Functional risk first (G2 below) but also perf — orphan rows accumulate; queries
  filtering by meeting type type-coerce nulls.
- Fix: explicit `onDelete: Restrict` for `meetingType` and `host`, document the policy.

### P19. `Calendar` table scanned per booking to find write-target — **S**
- File: `src/app/api/bookings/route.ts` line 138 (in-memory `find`), reschedule line 47.
- Already mitigated because `calendars` are loaded with `include` (≤ ~10 rows). No
  fix needed; flagged so future refactors don't introduce N+1 by switching to a
  separate query.

### P20. Availability engine pure but called inside booking transaction window — **S**
- File: `src/app/api/bookings/route.ts` lines 103–119.
- Engine runs ~CPU-bound per host. Fine for a single host, scales linearly with
  candidates. Pre-warm by computing inside the public page render (already done
  there) and pass the picked slot down — currently we recompute server-side for
  the security check, which is correct. Keep the recompute; just memoise per
  request if multiple round-robin candidates share calendars.

---

## 2. GDPR / privacy findings

EU-based controller, primarily processing colleague + invitee personal data via
Google + Zoom + Supabase + Resend + Vercel. Most items below are about closing
documentation gaps and adding explicit deletion / export paths.

### G1. No documented lawful basis register — **S** (docs only)
- Data: invitee email/name, intake answers, host email/calendar metadata, OAuth
  refresh tokens.
- Suggested basis:
  - Workspace + project members (`Host`, `WorkspaceMember`, `ProjectMember`):
    Art. 6(1)(b) — performance of contract / pre-contractual.
  - Public invitees (`Booking`, `PollResponse`): Art. 6(1)(f) legitimate interest
    (running the meeting they requested), with Art. 6(1)(b) where they are also
    contractual parties.
  - OAuth tokens (`Host.googleRefreshToken`, `Host.zoomRefreshToken`): Art. 6(1)(b)
    necessary to deliver the service.
- Fix: add a `docs/legal/lawful-basis.md` register; link from privacy policy.

### G2. No "right to erasure" path for a Booking or invitee — **M**
- File: `prisma/schema.prisma` `Booking` model lines 252–284.
- `Booking.host`, `Booking.meetingType`, `Booking.project` have no `onDelete`
  declaration → defaults to NoAction in Postgres, so deleting a Host fails while
  Bookings exist. There is no dedicated "delete invitee data" endpoint. Cancelling
  a booking does NOT remove `inviteeEmail`, `inviteeName`, `inviteeAnswers`.
- Fix: add an admin route that scrubs PII columns on `Booking` (replace email with
  `redacted+<id>@invalid`, set `inviteeName = 'Removed'`, null `inviteeAnswers`)
  while preserving the audit shell. Decide cascade strategy for Host deletion
  (probably soft-delete + scrub).

### G3. Intake answers retained indefinitely — **S**
- File: `prisma/schema.prisma` line 259 (`inviteeAnswers Json?`).
- No retention policy. Free-text intake fields can contain sensitive personal data
  ("what's your goal for this session?"). Stored forever.
- Fix: scheduled job that nulls `inviteeAnswers` on bookings older than 90 days
  (configurable per workspace). Document in privacy policy.

### G4. No subject access request (SAR) export tooling — **M**
- Schema models: `Booking.inviteeEmail`, `PollResponse.inviteeEmail`,
  `Invite.email`.
- A "give me everything you have on email X" request currently means hand-written
  SQL across three tables.
- Fix: add a server-only `npm run sar -- --email <x>` script that emits JSON for
  Booking, PollResponse, Invite where email matches (case-insensitive).

### G5. Refresh tokens stored in plaintext columns — **M**
- File: `prisma/schema.prisma` lines 72, 74 (`googleRefreshToken`,
  `zoomRefreshToken`).
- Encrypted at rest at the Supabase infrastructure layer (AES-256, in EU region if
  the project is `eu-central-1` / `eu-west-1` — confirm). Not column-encrypted.
  Anyone with `service_role` access (i.e. our service-role key — server-only, so
  acceptable, but anyone with a Supabase studio session) can read tokens.
- Fix: column-level encryption with `pgsodium` (Supabase supports it) or
  app-level with a KMS-held key in `serverEnv()`. Rotate keys quarterly.

### G6. PII in logs — emails leak via Resend & Zoom error paths — **S**
- File: `src/lib/email.ts` line 36 logs `{ to: recipients, subject }` when Resend
  is unconfigured. Recipients = invitee email.
- File: `src/app/api/bookings/route.ts` line 211, `[id]/cancel/route.ts` line 59,
  `[id]/reschedule/route.ts` line 126: `console.error("[…] zoom … failed", err)` —
  Zoom errors include host email + meeting topic which itself contains the
  invitee name.
- Fix: redact email locals (`a***@b***.com`) before logging; never log the full
  `err` object from third-party SDKs. Use a `safeLog()` helper.

### G7. Booking `requestId` leaks invitee email in deterministic hash — **S**
- File: `src/app/api/bookings/route.ts` lines 151–155.
- `sha256(meetingTypeId:hostId:startsAt:inviteeEmail).slice(0, 32)` — the hash is
  not reversible, but `requestId` is queryable and the input set is small enough
  that an attacker who knows three of four inputs can confirm the fourth.
- Fix: salt with `serverEnv().IDEMPOTENCY_SECRET` (HMAC-SHA256). Same uniqueness,
  not a confirmation oracle.

### G8. OAuth state cookie on Zoom flow — checks pass but `state` cookie attributes are loose — **S**
- File: `src/app/api/oauth/zoom/start/route.ts` lines 22–28.
- `httpOnly: true` ✓, `sameSite: "lax"` ✓, `secure` is gated on
  `NODE_ENV === "production"`. Fine. Path is `/`, scope is wider than needed —
  set `path: "/api/oauth/zoom"`. Low risk.

### G9. Supabase Auth cookies — relies on `@supabase/ssr` defaults — **S**
- File: `src/middleware.ts` lines 10–29. The `setAll` callback forwards `options`
  unchanged from Supabase. Spot-check that `secure`, `httpOnly`, `sameSite=lax`
  are actually set in production. Document for the privacy notice.

### G10. No data processor / sub-processor list & DPAs — **S** (docs)
- Sub-processors: Vercel (hosting), Supabase (DB + Auth — confirm region),
  Resend (US-based — Standard Contractual Clauses required for EU→US transfer),
  Google LLC (Calendar + Identity — Google Workspace DPA covers it),
  Zoom Video Communications (US — SCCs needed).
- Fix: add `docs/legal/sub-processors.md` listing each, region, transfer
  mechanism, and link to their DPA. Sign Resend's DPA explicitly.

### G11. Cross-border transfer not addressed in privacy notice — **S** (docs)
- Resend is US-only — every transactional email transits to a US processor. Zoom
  meetings are processed by Zoom in the US. Even with DPAs, you need SCCs +
  transfer-impact assessment per Schrems II.
- Fix: include the SCC/EU-US Data Privacy Framework note in the privacy policy
  (most processors are now DPF-certified — verify Resend & Zoom).

### G12. No audit log — **L**
- No `AuditLog` model in `prisma/schema.prisma`. Can't answer "who deleted this
  booking" or "who changed brand color" after the fact.
- Fix: add `AuditLog { id, actorHostId, action, subjectType, subjectId, diff Json,
  createdAt }`. Write from each settings/admin route handler. Useful for both
  debugging and Art. 30 records of processing activities.

### G13. Privacy policy / cookie banner / DPA surfaces missing — **S** (docs)
- No `/privacy`, `/terms`, `/legal/dpa` routes today. For a B2B-only product on a
  closed domain you can keep cookie usage essential-only and skip the banner —
  but you still need a published privacy notice that names processors and
  retention.
- Fix: add `/legal/privacy` static page; link from sign-in screen and footer;
  do NOT draft contents here — that's a Sjoerd-with-counsel call.

### G14. PollResponse retains email + votes after poll finalizes — **S**
- File: `prisma/schema.prisma` lines 322–336.
- Once a poll is FINALIZED or CANCELLED, response rows linger. Votes can be
  sensitive ("nope, can't do Friday" reveals patterns over time).
- Fix: scheduled job purges PollResponse 30 days after `Poll.status != OPEN`.

### G15. `Invite.token` lifetime is `expiresAt` only — no auto-cleanup — **S**
- File: `prisma/schema.prisma` lines 359–380.
- Tokens may grant access to a workspace if accepted late. Currently checked at
  use-time (presumed in `lib/invites.ts`), but expired tokens linger as PII
  (email + invited-by).
- Fix: cron `deleteMany({ where: { expiresAt: { lt: now }, acceptedAt: null } })`
  every 24 h. Pairs with index in P14.

### G16. Service-role key fan-out limited — good — note for record
- File: `src/lib/supabase/service.ts` line 13.
- Used only in `getGoogleRefreshTokenForAuthUser`. Stays server-side. No leak
  paths spotted. Document this restriction in `CLAUDE.md` (already partially
  noted in §Don'ts).

### G17. `getCurrentAuthUser` swallows errors — **S**
- File: `src/lib/auth.ts` line 14: `if (error) return null;`
- Silently failing auth is fine UX-wise but suppresses anomaly signals (e.g.
  forged JWT). Log via `safeLog` (G6) so security incidents surface.

### G18. `Host.email` uniqueness collides with the "claim placeholder Host" flow — **S** (privacy adjacent)
- File: `src/lib/auth.ts` lines 72–82.
- Seed creates placeholder Hosts keyed on email; first sign-in claims them. If a
  malicious user could trigger Supabase Auth with a colliding email (only
  possible inside the workspace domain), they would inherit the placeholder's
  workspace ownership. Today this is gated by the OAuth flow (must control
  Google account for `<email>@soul.com`), but worth a sanity check in
  `resolvePostSignIn` that the claimed Host's role is recomputed, not inherited.

### G19. Booking `meetUrl` and `providerMeetingId` retained on cancelled rows — **S**
- File: `src/app/api/bookings/[id]/cancel/route.ts` line 65.
- Cancel sets `googleEventId: null` but leaves Zoom `providerMeetingId` and
  `meetUrl`. Stale join URL = minor PII (could re-route later if Zoom re-uses
  IDs). Clear on cancel for hygiene.

### G20. No DSAR contact in code/docs — **S** (docs)
- Add a `privacy@soul.com` mailbox + Art. 13/14 notice template. Out of scope of
  this audit; flagged so it doesn't disappear into Sjoerd's inbox.

---

## Quick-win shortlist (do these first)

1. **P2 + P3** combined: 60-second freebusy cache. Single biggest win on the
   public booking hot path.
2. **G6**: redact email locals from logs. Half a day; protects you on every
   incident report.
3. **G2**: write a "scrub booking PII" admin endpoint. Required before you can
   confidently say "we honour erasure".
4. **P5**: add `@@index([hostId, status, startsAt])` migration. One line of
   schema, big effect on the dashboard.
5. **G5**: encrypt `googleRefreshToken` + `zoomRefreshToken` columns with
   `pgsodium`. The single highest-blast-radius secret in the database.

## Out-of-scope but noted

- Vercel region pinning (confirm `fra1` or similar EU region, not `iad1`).
- Supabase project region (must be EU for Schrems-II-clean operation).
- Resend DPF certification status (April 2026: verify on resend.com/legal).
