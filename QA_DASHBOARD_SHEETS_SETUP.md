# QA Dashboard — Google Sheets Read Access Setup

The QA Dashboard page (`src/pages/QaDashboardPage.tsx`) reads live, **read-only**
data from the QA team's master Google Sheet — the same workbook the
standalone Apps Script "Advisor QA Dashboard" already reads from. This app
never writes to that sheet.

## Recommended: "Connect Google Sheets" (no admin needed)

If you (or whoever will connect) already has access to the sheet, this is
the fastest path and involves no Workspace admin, no service account, and
no environment variables at all.

1. Sign in to the WebApp and open **Developer Controls** (visible to
   Admin/Developer tier).
2. Under **QA Dashboard — Google Sheets**, click **Connect Google Sheets**.
3. You'll land on Google's consent screen, already signed in as yourself.
   It'll ask you to grant this app one additional permission (read-only
   Google Sheets access) on top of the sign-in it already has. Approve it.
4. You're redirected back into the app, and Developer Controls now shows
   "Connected as `you@joinditto.in`".

That's it — the app now reads the sheet exactly as that account can, via an
encrypted refresh token stored in Postgres
(`qa_dashboard_google_connection` table; see
`src/server/qaDashboard/tokenCrypto.ts` for how it's encrypted at rest). No
sheet-sharing dialog, no Cloud Console, no IT ticket.

**Why this works without hitting the Workspace external-sharing policy**
that blocks service accounts: nothing is being "shared" with anyone here —
you're just granting the app (which you already trust enough to sign into)
one more permission on your own account, the same way any "Sign in with
Google, and also let this app read your Calendar" consent screen works.

**To disconnect:** click **Disconnect** in the same panel. To reconnect as
a different person, have them click Connect instead — the newest connection
always wins (single stored connection).

**If Connect fails with "Google did not return a refresh token":** the
account has a prior consent for this app cached without offline access.
Go to <https://myaccount.google.com/permissions>, remove this app's access,
and click Connect again.

## Alternative: service account (only if you specifically want a non-personal identity)

Skip this whole section unless you have a specific reason to prefer a
machine identity over a real person's OAuth grant (e.g. you don't want the
connection tied to any one employee's account). This path needs Google
Cloud Console access and, in many orgs, a Workspace admin.

### 1. Create a service account

In [Google Cloud Console](https://console.cloud.google.com/) → **IAM & Admin
→ Service Accounts**: create one (e.g. `qa-dashboard-reader`), then **Keys**
→ **Add Key** → **Create new key** → JSON. Treat the downloaded file like a
password.

### 2. Enable the Sheets API

Cloud Console → **APIs & Services → Library** → search "Google Sheets API"
→ **Enable**.

### 3. Grant access — direct share or domain-wide delegation

**Direct share (try first):** open
<https://docs.google.com/spreadsheets/d/1G3x6NyoeLKHNvCmivgHZbEChnyskQVH8RgL3SlmmzWY/edit>,
**Share**, add the service account's email as **Viewer**.

If that fails with *"The policy set by the administrators of &lt;org&gt;
prohibits the sharing of items with `...iam.gserviceaccount.com`, because it
is not a Google Account in a compatible allowlisted domain"* — your
Workspace blocks sharing with non-domain identities. Use **domain-wide
delegation** instead:

1. Cloud Console → the service account → **Details** → note its numeric
   **Client ID**.
2. [Google Workspace Admin Console](https://admin.google.com/) (needs a
   Workspace Admin) → **Security → API Controls → Domain-wide Delegation**
   → **Add new** → Client ID from step 1, scope
   `https://www.googleapis.com/auth/spreadsheets.readonly` → Authorize.
3. Pick a real `@joinditto.in` user who already has sheet access — the
   service account will impersonate them via `QA_DASHBOARD_IMPERSONATE_SUBJECT`.

### 4. Set environment variables

| Variable | Value |
|---|---|
| `QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY` | full contents of the JSON key file, as a single string |
| `QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | path to that JSON key file on disk (local dev only) — set only one of these two |
| `QA_DASHBOARD_IMPERSONATE_SUBJECT` | only if you used domain-wide delegation above |

Note: if a connection exists via the in-app "Connect Google Sheets" button
above, it always takes priority over these env vars (see
`src/server/qaDashboard/sheetsClient.ts`'s auth-resolution order) — these
only take effect when no such connection is stored.

## Test the flow end-to-end

1. Sign in to the WebApp with a `@joinditto.in` account and open **QA
   Dashboard** from the sidebar.
2. If your account holds Admin/Guide/Mentor access (grant it under **User
   Directory & Management -> QA Dashboard Access**, Admin or Developer
   tier), you should land on the advisor roster with Lead Score / Payments
   QA columns populated. If your account matches an `Email ID` in
   `master_advisors` instead, you land directly on that advisor's own
   scorecard.
3. Check the server logs for `QA Dashboard: failed to load...` errors if
   anything 500s — the error message names which of the two auth paths
   (connected account vs. service account) is missing or misconfigured.

## What this does NOT cover

- **Write access.** No code path anywhere in this integration writes to the
  sheet — enforced by only ever requesting the `spreadsheets.readonly`
  scope, whichever auth path is in use.
- **Role management.** Covered — see **User Directory & Management -> QA
  Dashboard Access** (Admin or Developer tier). No env var edit or restart
  needed; changes take effect on the next request.
- **Schema changes.** If the QA team ever renames columns in
  `master_advisors` or `master_feedback_dump`,
  `src/server/qaDashboard/qaDataEngine.ts` throws a clear "Expected column
  ... not found" error rather than silently producing wrong numbers — a
  code change, not a config change.
