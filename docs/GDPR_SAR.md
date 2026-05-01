# GDPR Subject Access Request (SAR) — Soul Suite

Closes audit item **G4** in `docs/PERF_AND_GDPR.md`. Provides a single command
(or admin endpoint) that produces a JSON dump of every record Soul Suite holds
about a given email address, in the shape required to fulfil an Art. 15
right-of-access request.

This tooling is for **handling legitimate subject access requests** — not for
routine data export, analytics, or backup. Each invocation reads PII; treat the
output file accordingly (encrypt in transit, delete after the request is
closed).

---

## What gets exported

Matched case-insensitively against the supplied email:

| Table              | Match column          | Notes                                                                     |
| ------------------ | --------------------- | ------------------------------------------------------------------------- |
| `Host`             | `email`               | Profile fields included; `googleRefreshToken` / `zoomRefreshToken` masked to `"present"` / `"absent"`. |
| `WorkspaceMember`  | via `Host.id`         | Workspace name, slug, role, `joinedAt`.                                   |
| `ProjectMember`    | via `Host.id`         | Project name, slug, role, `addedAt`, `lastAssignedAt`.                    |
| `MeetingType`      | via `Host.id` (PERSONAL) | Slug, name, scope, duration, `createdAt`. Project-scoped MTs not included. |
| `Booking`          | `inviteeEmail`        | Joined host name + meeting type name. Includes `inviteeAnswers` JSON.     |
| `PollResponse`     | `inviteeEmail`        | Joined poll name + status; full `votes` JSON.                             |
| `Invite`           | `email`               | Kind, role, timestamps.                                                   |

The output JSON also has a `meta.rowCounts` summary at the top.

---

## Running the script

```bash
# Print to stdout
npm run sar:export -- person@example.com

# Or write to a file
npm run sar:export -- person@example.com --out /tmp/sar.json

# Equivalent direct invocation
npx tsx scripts/sar-export.ts person@example.com --out /tmp/sar.json
```

The script connects via the same `DATABASE_URL` as the running app. Run it on
a machine that can reach the production database (or a backup snapshot). It
prints row counts to stderr when `--out` is set so the human running the
request gets immediate feedback.

---

## Using the admin endpoint

`POST /api/admin/sar-export`

- **Auth**: caller must be a workspace `OWNER`. `ADMIN`s and `MEMBER`s get
  `403 forbidden`.
- **Body**: `{ "email": "person@example.com" }`
- **Response**: `application/json` body, identical to the script output, with
  `Content-Disposition: attachment; filename="sar-export-<slug>-<date>.json"`
  so a browser fetch saves the file straight to disk.

Example using `curl` from a signed-in browser session (cookie jar required):

```bash
curl -X POST https://<host>/api/admin/sar-export \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"email":"person@example.com"}' \
  -o sar-export.json
```

---

## Operational notes

- **Retention of the export file**: don't keep these around. Send to the
  requester via a secure channel and then delete the local copy.
- **Refresh tokens**: never present in the export, even if the matched Host
  has them. The export indicates only `"present"` / `"absent"` so the
  requester knows whether we are still able to talk to their Google calendar.
- **Erasure**: this is the *access* path only. For the right-to-be-forgotten
  flow, see audit item G2 in `docs/PERF_AND_GDPR.md`. Erasure of Host rows is
  a manual decision (cascades into Workspace ownership) and not automated.
- **Audit**: there is currently no AuditLog (audit item G12). Document the
  request and the date you ran the export in your DSAR ticket tracker until
  the audit log lands.
