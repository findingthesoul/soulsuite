# Soul Suite

Self-hosted scheduling layer on top of Google Calendar for the Soul collective.

This repo currently delivers **step 1** of the brief's build order: auth + first-login workspace bootstrap + host calendar picker + working hours. The Prisma schema models the entire v1 domain so future steps don't need migrations for things already specified.

See `soul-scheduler-brief.md` for the full spec.

---

## Tech

- Next.js 15 (App Router) + React 19, TypeScript
- Supabase (Postgres + Auth)
- Prisma for schema and migrations
- `googleapis` server-side
- Tailwind v4

---

## Local setup

### 1. Clone and install

```bash
git clone <repo-url>
cd "souls calendar"
npm install
```

Node 20+ required.

### 2. Google Cloud project

You need an OAuth client whose ID/secret you'll plug into both Supabase and the app.

1. Go to <https://console.cloud.google.com>, create a project (or pick one).
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Internal only works if your domain is on Google Workspace and you don't need external collaborators — but external collaborators are part of v1, so use External).
   - App name: `Soul Suite`. Support email: yours.
   - **Scopes**: add
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `openid`
     - `.../auth/calendar.events`
     - `.../auth/calendar.readonly`
   - Add yourself + Remco + any tester as **Test users** while the app is unverified.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**.
   - **Authorized redirect URIs** — you need TWO:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback` (Supabase's OAuth handler)
     - `http://localhost:3000/auth/callback` (this app, for local dev)
   - Add the production URL `https://<your-domain>/auth/callback` once you deploy.
5. Copy the **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### 3. Supabase project

1. Create a project at <https://supabase.com>.
2. **Authentication → Providers → Google**: enable, paste the same Client ID + Secret. In **Additional scopes**, add: `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly`.
3. **Authentication → URL Configuration**: add `http://localhost:3000/auth/callback` and your production URL to **Redirect URLs**.
4. **Project Settings → Database → Connection string**:
   - "Transaction" pooler → `DATABASE_URL` (used by app at runtime).
   - "Session" pooler or direct 5432 → `DIRECT_URL` (used by `prisma migrate`).
5. **Project Settings → API**: copy the URL, anon key, service role key.

### 4. Env

```bash
cp .env.example .env
# fill in DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_TOKEN_SECRET
```

`APP_TOKEN_SECRET` (32+ bytes): `openssl rand -base64 32`.

### 5. Database

```bash
npm run prisma:migrate -- --name init
npm run db:seed
```

Migrate creates the schema. Seed inserts the Soul workspace, two demo hosts, one project, two meeting types, and reserves route-collision slugs.

### 6. Run

```bash
npm run dev
# http://localhost:3000
```

The first time you sign in with an `@soul.com` Google account:
- A Host row is created and the workspace seed becomes the OWNER (or, if the seed didn't run, the workspace is bootstrapped on the fly).
- You're routed through `/onboarding/calendars` → `/onboarding/working-hours` → `/dashboard`.

Sign-ins from other domains require a pending project invite (not yet exposed in UI — drop a row into `Invite` directly for now, or wait for step 5 of the build order).

---

## Useful commands

```bash
npm run dev                # next dev
npm run build              # prisma generate + next build
npm run typecheck          # tsc --noEmit
npm run prisma:studio      # browse/edit DB rows
npm run prisma:migrate     # create + apply a migration
npm run prisma:deploy      # apply migrations in CI / prod
npm run db:seed            # idempotent seed
npm run test               # vitest (no tests yet)
```

---

## Deploy (Vercel)

1. Push to GitHub (or use `vercel` CLI).
2. Import the repo at <https://vercel.com/new>.
3. Add the same env vars as `.env`. Update `NEXT_PUBLIC_APP_URL` to your production URL.
4. Add the production URL to:
   - Google Cloud OAuth client → **Authorized redirect URIs**: `https://<domain>/auth/callback`
   - Supabase → **Authentication → URL Configuration → Redirect URLs**: `https://<domain>/auth/callback`
5. The `build` script runs `prisma generate && next build`. Migrations need a separate step — either run `npm run prisma:deploy` from your laptop pointed at production, or add a CI job that runs it on push to `main`.

---

## Repo layout

```
prisma/
  schema.prisma           # full v1 domain model (workspaces, projects, meeting types, polls, invites)
  seed.ts                 # idempotent seed (Soul workspace + demo data)
src/
  app/
    auth/                 # sign-in, OAuth callback, sign-out, error
    onboarding/           # calendar picker, working hours
    api/onboarding/       # POST handlers for the onboarding forms
    dashboard/            # minimal dashboard (host + project memberships)
    request-access/       # @soul.com without invite
  lib/
    env.ts                # zod-validated env, public + server split
    prisma.ts             # singleton Prisma client
    supabase/             # browser, server-with-cookies, service-role
    google/client.ts      # googleapis OAuth client per host
    auth.ts               # getCurrentHost, ensureHostFromAuthUser, domain check
    workspace.ts          # post-sign-in resolver: workspace bootstrap, invite acceptance
    slugs.ts              # cross-table slug uniqueness + reserved list
  middleware.ts           # Supabase session refresh on every request
```

---

## What's NOT here yet

Per the brief's build order, future steps will add:

- 2–3: availability engine + booking flow + buffers/notice/advance — **the riskiest piece**, gets tests
- 4: workspace invites UI + workspace settings
- 5: project CRUD + project settings + member management
- 6: project meeting types + project booking URLs
- 7: external project invites
- 8: intake forms + conditional logic
- 9: multi-calendar conflict checks (schema is ready; engine is the new code)
- 10: round-robin within projects
- 11: group polls
- 12: cancel/reschedule + email + dashboards polish

Open questions from the brief that still need a call before code lands: shared-vs-personal dashboard scope, round-robin fairness rule (default: least-recently-assigned, per schema), poll vote visibility (default: visible), email sender domain.
