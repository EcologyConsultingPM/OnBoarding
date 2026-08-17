[README.md](https://github.com/user-attachments/files/31125666/README.md)
# Ecology Consulting — Onboarding Workbook

New employee onboarding workbook for Ecology Consulting, with Learning &
Development Modules and a Training Library nested inside it. Real
login (password or magic link), staff/admin roles, per-person progress
tracking, and a shared live database via Supabase.

## How access works

- **Sign in**: pick Admin or Staff portal, then Password or Email link.
  Any verified `@ecologyconsulting.au` email can sign in.
- **Password accounts**: created by an admin via the Staff Logins panel,
  which issues a unique one-time temporary password. Whoever receives it
  is forced to set their own password the moment they sign in
  (`app_metadata.must_change_password`, cleared server-side once they do).
- **Forgot password**: built on Supabase's own reset-email flow — no
  custom code touches passwords for this path.
- **Settings**: any signed-in user (staff or admin) can change their own
  password at any time from the Settings button in the header — this is
  also the fix if an admin ever ends up with no password at all: sign in
  via Email link, then set one yourself in Settings.
- **Admin**: only emails in the `admin_emails` table get admin rights —
  editing modules, sign-offs, links, structural content, creating staff
  logins, and managing who else is an admin. Enforced server-side via
  Postgres Row Level Security, not just hidden in the UI.
- **Domain restriction**: enforced at the database level by a trigger on
  `auth.users` — accounts outside `@ecologyconsulting.au` can't be created
  at all, regardless of sign-in method.

## Project structure

```
ecology-onboarding/
├── app/
│   ├── layout.js                    Root layout, wraps everything in AuthProvider
│   ├── page.js                       Gates on auth + forced password change, then renders the workbook
│   ├── login/page.js                  Portal picker + password/email-link/forgot-password
│   ├── change-password/page.js        Forced first-login password change
│   ├── reset-password/page.js         Lands here from the emailed reset link
│   ├── api/
│   │   ├── admin/invite-staff/route.js  Admin-only: create/reset a staff login
│   │   ├── admin/staff/route.js          Admin-only: staff roster + per-person progress
│   │   └── clear-password-flag/route.js  Clears must_change_password for the caller only
│   └── globals.css                    Brand fonts, base resets
├── components/
│   ├── OnboardingWorkbook.js   The whole app: nav, checklist sections, module library,
│   │                            sign-offs, Settings modal, Staff Logins, Admin access,
│   │                            Staff Progress dashboard
│   └── TrainingLibrary.js      Read-only in-app view of the capability framework,
│                                values, assessment ratings, and module guides
├── lib/
│   ├── supabaseClient.js   Supabase browser client
│   ├── AuthProvider.js     Session/role/password context (React)
│   ├── data.js             All reads/writes to Supabase
│   └── capabilityData.json  Real capability framework data, powers the Training Library
├── public/
│   └── logo.png             Ecology Consulting logo, transparent background
├── sql/
│   └── 2026-staff-progress.sql   Per-user progress schema (already applied live)
├── package.json
└── next.config.js
```

## Supabase project

Dedicated project: **Ecology Consulting On Boarding** (`mqgumjgotjiphfgqdyyl`),
under its own Supabase org, separate from Solum Safety's. Schema, RLS, and
the admin allowlist are already applied. Tables in the `public` schema:
`phases`, `sections`, `checklist_items`, `item_progress`, `item_links`,
`ld_months`, `ld_modules`, `signoffs`, `admin_emails`, `staff_progress`.

`item_progress` (done/date/notes) is shared, used for Learning & Development
module topics. `staff_progress` is per-user, used for onboarding checklist
items — each person's own name/position/dates/notes, isolated by RLS.

### Manual steps required in the Supabase dashboard (not settable via API)

1. **Authentication → URL Configuration**: set Site URL to your deployed
   URL, and add both `http://localhost:3000` and your deployed URL to
   Redirect URLs — needed for magic links and password reset emails to
   land back in the app correctly.
2. If you ever rotate the service role key, update it in Vercel too (see
   Environment Variables below) — the admin API routes need it.

## Environment variables

Set in Vercel (Project Settings → Environment Variables) and in a local
`.env.local` for `npm run dev`:

```
NEXT_PUBLIC_SUPABASE_URL=https://mqgumjgotjiphfgqdyyl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key — Supabase → Project Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<service role key — same page, keep this one secret, server-only>
```

The anon key is safe to expose client-side by design. The service role key
is NOT — it's only ever read server-side (the three API routes above), never
prefixed with `NEXT_PUBLIC_`, and must never appear in client-bundled code.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — you'll land on the login page.

## Deploying

Standard Next.js app — connect the repo to Vercel, add the three
environment variables above, deploy.

## Pushing this to GitHub

```bash
git remote add origin https://github.com/SolumSafety/onboarding-workbook.git
git push origin main
```
