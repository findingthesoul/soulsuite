# Soul Suite — engineering guide

The brief at `~/Downloads/soul-scheduler-brief.md` is the source of truth for product spec. This file documents *how we build it*: architecture, conventions, way of working. Read both before making non-trivial changes.

## What this is

A self-hosted scheduling layer on top of Google Calendar for the Soul collective (Sjoerd, Remco, others at soul.com). Three-layer model: Workspace → Project → Personal. See brief §Context.

## Stack

- **Runtime:** Node.js 20+, TypeScript strict.
- **Framework:** Next.js 15 (App Router) + React 19. Server Components by default; `"use client"` only for interactive UI.
- **Database:** Postgres on Supabase. Prisma owns the schema — never edit tables in the Supabase dashboard. `prisma migrate dev` locally, `prisma migrate deploy` in CI.
- **Auth:** Supabase Auth with Google OAuth (offline access for refresh tokens). Refresh tokens are surfaced in the session at `exchangeCodeForSession` time *only* — captured in `src/app/auth/callback/route.ts` and stored on `Host.googleRefreshToken`.
- **Calendar API:** `googleapis`, server-side only. Per-host OAuth2 client built from the stored refresh token (`src/lib/google/client.ts`).
- **UI:** Tailwind v4 + CSS-variable tokens. shadcn-style primitives we own — components live in `src/components/ui/`.

## Architecture

```
prisma/
  schema.prisma           # full v1 domain (workspaces, projects, meeting types, polls, invites)
  seed.ts                 # idempotent seed; placeholder Host rows are CLAIMED on first real sign-in (see auth.ts)
src/
  app/                    # Next.js App Router
    auth/                 # sign-in, OAuth callback, sign-out, error
    onboarding/           # calendar picker, working hours
    settings/             # /settings index + /settings/branding (admin-only)
    api/                  # POST handlers (calendars, working-hours, branding) — auth-gated
    dashboard/            # signed-in landing
  lib/
    env.ts                # zod-validated env (publicEnv / serverEnv)
    prisma.ts             # singleton Prisma client
    supabase/{client,server,service}.ts  # browser / cookie-bound / service-role
    google/client.ts      # per-host OAuth2 + isGoogleAuthError
    auth.ts               # getCurrentHost, ensureHostFromAuthUser, isWorkspaceDomain
    workspace.ts          # post-sign-in resolver (bootstrap, invite acceptance)
    permissions.ts        # workspace role helpers (canManageWorkspace)
    page-context.ts       # getPageContextOrRedirect + shellProps for AppShell pages
    slugs.{ts,constants.ts}  # cross-table slug uniqueness + reserved list
    availability/         # pure availability engine + tz utils + freebusy fetcher
  components/
    ui/                   # primitives — Button, Card, Input, Select, Label, Avatar, DropdownMenu
    theme-provider.tsx    # light/dark/system, persisted, no FOUC
    user-menu.tsx         # top-right avatar dropdown (settings, theme, sign out)
    app-shell.tsx         # AppShell + CenterShell — every page uses one
  middleware.ts           # refreshes Supabase session cookies on every request
```

## Conventions

### Design system: single source of truth
Every UI primitive lives in `src/components/ui/`. **Never re-style raw `<button>`, `<select>`, `<input>` inline.** Add a variant to the component if you need a new style. Tokens (color, radius) live as CSS variables in `globals.css` and are exposed to Tailwind via `@theme`. Reason: previous projects had styling drift across pages that took weeks to clean up.

### Theme
Light is the default. The `.dark` class on `<html>` toggles dark. Three-mode toggle (light / dark / system) persisted to `localStorage`, hydrated by an inline script in `<head>` to avoid flash. `ThemeProvider` is the only component that touches the `dark` class.

### Server vs. client components
Pages are Server Components. Reach for `"use client"` only when the file uses hooks, event handlers, or browser APIs. Forms typically split: a server `page.tsx` that loads data + renders shell, and a sibling `form.tsx` (`"use client"`) that handles state and POSTs to a route handler.

### Page boilerplate
Every authenticated page starts:
```ts
const ctx = await getPageContextOrRedirect();
return <AppShell {...shellProps(ctx)}>...</AppShell>;
```
That gives you `host`, optional `workspace`, and a header with logo + user menu pre-wired. Workspace `brandColor` overrides the `--primary` token at the shell level so the accent matches across the page.

### Permissions
Server routes and pages must check the caller's role. Helpers in `src/lib/permissions.ts` (`canManageWorkspace`, etc.). Workspace settings require owner/admin. Project settings require lead. External collaborators see only their projects.

### API routes
POST handlers live in `src/app/api/.../route.ts`. Each one:
1. Loads the current host (`getCurrentHost`); 401 if missing.
2. Checks role (`canManageWorkspace`, `canManageProject`, etc.); 403 if not allowed.
3. Validates body with zod; 400 on invalid input.
4. Performs the write inside a transaction when multiple rows must be consistent.

### Idempotency & race conditions (booking flow)
- Booking creation must be idempotent — store `requestId` per booking and let the unique index reject duplicates (brief §Idempotency).
- Re-validate availability inside the booking transaction with a fresh freebusy query (brief §Race conditions). If the slot is gone, return a clean error and refresh the picker.

### Slugs
`Host.slug` and `Project.slug` share `/{slug}/...` URL space. `src/lib/slugs.ts` enforces cross-table uniqueness + reserved-list at the app level. A future SQL trigger will back this at the DB level (see brief §Slug collisions).

### Timezones
Everything stored in UTC. Render in invitee's detected timezone with manual override. Test DST transitions explicitly — the availability engine has unit tests that cover this (`src/lib/availability/engine.test.ts`).

### Env
Validated by zod at module load (`src/lib/env.ts`). Public vs. server split. Service-role key is server-only — never reach for it in a client component.

## Way of working

### Build order
Follow the brief's §Build order, top to bottom. Each step ends with a working deploy — no big-bang integration. Steps 1–3 are the riskiest; the rest is mostly assembly.

Current state: step 1 (auth + workspace bootstrap + calendar picker) is live; step 2 (single-host meeting type + availability engine + booking flow) is in progress.

### Tests
The brief explicitly calls for tests on the availability engine + workspace/project permission checks. Other surfaces lean on manual QA for v1. Use Vitest. Prefer pure functions you can hit with synthetic data (the engine takes `now` as a parameter for this reason).

### Open questions
Four unresolved decisions in the brief's §Open questions. We've coded defaults but should confirm with Sjoerd before they ship to users:
1. Shared dashboard vs. per-host
2. Round-robin fairness rule (current default: least-recently-assigned)
3. Poll vote visibility (current default: visible to other invitees)
4. Email sender domain (DNS setup before Resend/Postmark works)

### Backlog
Sjoerd-flagged items not yet built — see `~/.claude/projects/-Users-sjoerdair-Projects-souls-calendar/memory/project_backlog.md` (gets auto-surfaced when working in this repo). Pull from there when finishing a build-order step.

### PRs
Branch off `main`, push, and open a PR via `https://github.com/findingthesoul/soulsuite/pull/new/<branch>` (no `gh` CLI on this machine). Commit messages explain *why*, not what. Co-Authored-By trailer for Claude commits.

### Don'ts

- Don't re-style raw HTML elements inline. Use `@/components/ui/*`.
- Don't write the same query in two places — make a server helper in `src/lib/`.
- Don't add features outside the brief without explicit user agreement.
- Don't add features Sjoerd didn't ask for "while I'm in there." Defer to backlog.
- Don't introduce backwards-compat shims for code you just wrote.
- Don't disable Google's "unverified app" warning by submitting for verification — Soul Suite is a private tool, Test users are sufficient.
- Don't use the Supabase service-role key in client components or expose it via NEXT_PUBLIC_ vars.
- Don't bypass `prisma migrate` — never edit DB schema in the Supabase dashboard.
