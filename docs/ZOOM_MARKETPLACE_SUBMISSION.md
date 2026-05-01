# Zoom Marketplace submission packet — Soul Suite

Everything you need to paste into Zoom Marketplace's app submission flow. Copy each section
into the corresponding field on marketplace.zoom.us. Reviewer questions usually come back
in 5–10 business days.

---

## URLs

| Field | Value |
| --- | --- |
| App home page | `https://suite.soul.com` |
| Privacy Policy | `https://suite.soul.com/privacy` |
| Terms of Use | `https://suite.soul.com/terms` |
| Support URL | `https://suite.soul.com/support` |
| Support email | `support@soul.com` |
| Documentation URL | `https://suite.soul.com/support` |

> Privacy + Terms live in the app at /privacy and /terms (added in this PR). Support page
> already exists.

---

## Basic information

**App name:** `Soul Suite`

**Short description (≤ 80 chars):**
> Private scheduling layer on top of Google Calendar for the Soul collective.

**Long description (~1000 chars):**
> Soul Suite is the Soul collective's internal booking and scheduling tool, layered on top
> of Google Calendar. Members publish bookable links so colleagues, clients, and partners
> can pick a time without back-and-forth. Soul Suite reads availability from Google Calendar,
> writes the new booking back as a Google Calendar event, and — when a meeting type is
> configured to use Zoom — creates the corresponding scheduled Zoom meeting on the host's
> Zoom account. Each host's Zoom is connected via OAuth from /settings/connections and stays
> independent: Soul Suite never reaches across host accounts. Invitees see a single clean
> booking page; hosts see all their bookings, can reschedule or cancel, and get email
> confirmations with Google Meet or Zoom links auto-attached. The tool is invite-only and
> not commercially offered.

**Categories:** `Scheduling`, `Productivity`

**Pricing:** `Free` (private tool, not commercially offered)

---

## OAuth scopes & justifications

Two scopes only. Keep these answers to the reviewer concise and link the API call to the
user-facing feature.

### `meeting:write:meeting`

> When an invitee books a meeting type that the host has configured to use Zoom (rather
> than Google Meet), Soul Suite calls `POST /v2/users/me/meetings` to create a scheduled
> Zoom meeting on the host's account, then attaches the resulting join URL to the Google
> Calendar event description and to our email confirmation. On reschedule we call
> `PATCH /v2/meetings/{id}` to update the start time. On cancel we call
> `DELETE /v2/meetings/{id}` to clean up the meeting. Without this scope the Zoom-conferencing
> feature can't work.

### `user:read:user`

> Once a host completes the OAuth handshake, Soul Suite calls `GET /v2/users/me` exactly
> once to retrieve their Zoom account email. We display that email back to the host on
> /settings/connections so they can confirm "yes, I connected the right Zoom account" — and
> we store it for support troubleshooting. We never read profile photos, status, or any
> other user fields.

### Scopes we explicitly do NOT request

- No webinar, recording, chat, phone, or contact scopes.
- No account-level admin scopes.
- No SDK / Zoom Apps scopes.

---

## Test instructions for the Zoom reviewer

> **Test account:** Soul Suite is invite-only, so we'll need to provide the reviewer with a
> short-lived test workspace member account. This can be set up via /settings/members on
> request — or we can pre-create one and include the credentials below at submission time.

### Pre-flight (one-time, by Soul team before submission)

1. Create a test user in Soul Suite (workspace member role).
2. Have that user complete onboarding: pick a calendar to write to (a fresh Google account
   with empty calendar is fine), set working hours.
3. Have that user connect their Zoom test account at /settings/connections (Connect Zoom).

### Test scenario for the reviewer

1. Sign in to suite.soul.com as the provided test user.
2. Go to **Personal → + New → One-on-one** (or Scheduling → New). Create a meeting type:
   - Name: "Zoom Reviewer Test"
   - Duration: 30 minutes
   - **Conferencing → Zoom**
   - Save.
3. Open the public booking link shown on the meeting type page (an external/incognito browser
   tab is fine — bookings are public).
4. Pick any future slot, fill in name + email (use any test inbox), submit.
5. Verify three things:
   - The booking confirmation page shows a "Zoom — join link" pointing to the new meeting.
   - The host's Zoom account (via Zoom UI: Meetings → Upcoming) shows the newly created
     scheduled meeting at the right time.
   - The host's Google Calendar event description includes the Zoom join URL.
6. From the booking confirmation page, click **Reschedule** and pick a different slot. Verify
   the Zoom meeting's start time updates accordingly.
7. From the booking confirmation page, click **Cancel**. Verify the Zoom meeting is removed
   from the host's Upcoming meetings list.

### Expected API calls observable by the reviewer

| Step | Zoom API call |
| --- | --- |
| OAuth callback (during pre-flight #3) | `POST /oauth/token` (code exchange + token refresh) |
| OAuth callback | `GET /v2/users/me` (one-time, to fetch host email) |
| Booking creation (step 4) | `POST /v2/users/me/meetings` |
| Reschedule (step 6) | `PATCH /v2/meetings/{id}` |
| Cancel (step 7) | `DELETE /v2/meetings/{id}` |

### Disconnect path

The host can disconnect Zoom at any time at /settings/connections. On disconnect we delete
the stored refresh token and clear the in-process access-token cache; subsequent Zoom-using
bookings on that host's meeting types will return a clear "host hasn't connected Zoom" error
to the invitee.

---

## App icon

192x192 PNG. Use the Soul logo. If we don't have a high-res version, generate one as a
solid Soul-yellow square with "S" in the centre — Zoom accepts simple icons.

---

## Surfaces / features

Soul Suite is a **User-managed OAuth app** — no Zoom App SDK, no marketplace surface, no
embedded UI inside Zoom. We exchange an OAuth code for tokens and call the REST API. The
"Surface", "Embed", "Connect", and "Custom Form" sections in the Zoom Marketplace dev portal
should remain empty.

---

## Submission checklist

- [ ] Privacy Policy live at `https://suite.soul.com/privacy`
- [ ] Terms of Use live at `https://suite.soul.com/terms`
- [ ] Support page live at `https://suite.soul.com/support`
- [ ] App icon uploaded (192x192 PNG)
- [ ] Short + long descriptions pasted into Basic Information
- [ ] Scopes added with the justifications above
- [ ] Test instructions pasted into the Submission step
- [ ] Test user credentials supplied to the reviewer (separate, not in this doc)
- [ ] Submitted

---

## After submission

Zoom emails the reviewer's questions to the developer email on file (currently
sjoerd@soul.com). Most apps go through 1–2 rounds of clarification. Common review feedback:

- "Justify scope X more concretely" — add screenshots of where the scope is used in the UI.
- "Privacy Policy doesn't mention Zoom data" — already covered in our /privacy page.
- "Test instructions don't work for our reviewer" — usually means the test user wasn't
  properly set up; re-create and re-share.

While in review the **dev-mode app keeps working for users on Sjoerd's Zoom account** — so
nothing breaks during the review window. Once approved + published, the same OAuth flow
becomes available to any Zoom user (any account), which is the goal.
