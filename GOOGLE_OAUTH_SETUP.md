# Google Workspace OAuth Setup & Verification Checklist

This app now has real, server-side Google OAuth login wired up (Phase 4b), restricted to `@joinditto.in` Google Workspace accounts. It won't work until the items below are configured in your Google Cloud project. None of this can be done or verified from this session — it requires access to your Google Cloud Console and Workspace Admin console.

## 1. Create the OAuth 2.0 Client

In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**:

1. Create an **OAuth 2.0 Client ID** of type **Web application**.
2. Under **Authorized redirect URIs**, add exactly:
   ```
   https://<your-cloud-run-url>/api/auth/google/callback
   ```
   For local dev, also add `http://localhost:3000/api/auth/google/callback` (or whatever port you use).
3. Copy the generated **Client ID** and **Client Secret**.

If you already have an OAuth client from earlier work, you can reuse it — just make sure the redirect URI above is added to it.

## 2. Configure the OAuth consent screen

Still in Cloud Console → **APIs & Services → OAuth consent screen**:

- User type: **Internal** (restricts sign-in to your Google Workspace org at the Google level, in addition to the app's own server-side domain check).
- Scopes: `openid`, `email`, `profile` (no sensitive/restricted scopes needed for login).

## 3. Set environment variables

Wherever this app's secrets are configured (AI Studio Secrets panel for the deployed Cloud Run service, or a local `.env` for dev — see `.env.example`):

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `SESSION_SECRET` | any random 32+ byte string, e.g. output of `openssl rand -base64 32` |

`APP_URL` should already be set (AI Studio injects it automatically) — it's used to build the redirect URI, so it must match what you registered in step 1.

## 4. Test the flow end-to-end

Once the above is in place:

1. Visit the app while logged out. Click **Sign in with Google**.
2. You should land on Google's real consent screen, pre-filtered to your Workspace accounts.
3. Sign in with a `@joinditto.in` account. You should be redirected back into the app, either straight into the lookup screen (if your email is already in the internal `usersList`) or into the "Create Workforce Profile" screen to set your TACT ID (first time only).
4. Try signing in with a personal Gmail account (not `@joinditto.in`) — this should be **rejected** with a "Sign-in failed... Access restricted to @joinditto.in" message. This is the server-side check in `src/server/auth/googleOAuth.ts`, not just the UI hint, so it should hold even if you bypass the account picker.
5. Log out, then reload the page — you should land back on the login screen (no stale session).

## 5. What's NOT covered by this checklist

- **Role/permission assignment** (who is Owner/Admin/General) still comes from the app's internal `usersList`, not from Google — that moves to Google Groups (`Declaration-Owners`, `Declaration-Admins`, `All-Ditto`) in the next phase, which will need:
  - A Google Workspace service account with **domain-wide delegation** enabled for the Admin SDK Directory API, so the server can look up group membership.
  - `GOOGLE_ADMIN_SDK_SUBJECT` and `GOOGLE_APPLICATION_CREDENTIALS` (already documented in `.env.example`) set once that's ready.
- This checklist only validates *login*, not authorization — those are separate concerns by design (see Phase 4c).

If any step above fails or behaves unexpectedly, let me know exactly what you see (the error message, or which step you got stuck on) and I can help debug from the server logs / code side.
