[RECOMMENDED_UPDATED_STRUCTURE.md](https://github.com/user-attachments/files/31125854/RECOMMENDED_UPDATED_STRUCTURE.md)
# Recommended Updated Structure — Ecology OnBoarding

This structure keeps the existing Supabase authentication, self-service password change, logout flow, Staff Progress, Draft Onboarding and Resource Library. It breaks the large `OnboardingWorkbook.js` into focused modules so the ecology portal design, Staff/Admin boundaries and future SWMS drafting tools can be added safely.

> **Keep the production domain:** `https://on-boarding-ivory.vercel.app/`.

```text
ecology-onboarding/
├── app/
│   ├── layout.js                         Root layout; fonts, metadata and AuthProvider
│   ├── page.js                           Auth gate and role-aware post-login redirect
│   ├── globals.css                       Global Ecology visual tokens, responsive rules and imagery
│   ├── login/
│   │   └── page.js                       Existing password/email-link/forgot-password entry
│   ├── change-password/
│   │   └── page.js                       Keep: signed-in person changes only their own password
│   ├── reset-password/
│   │   └── page.js                       Keep: password-reset email destination
│   ├── admin/
│   │   ├── page.js                       Admin task-first landing page
│   │   ├── staff-progress/page.js        Administrator-only roster and progress review
│   │   ├── draft-onboarding/page.js      Administrator-only onboarding-path builder
│   │   ├── staff-access/page.js          Administrator-only new Staff login / Admin access
│   │   └── resources/page.js             Administrator-managed capability/resource library
│   ├── staff/
│   │   ├── page.js                       Staff personal-work landing page
│   │   ├── my-onboarding/page.js         Staff-only assigned onboarding checklist
│   │   ├── learning/page.js              Staff learning modules, resources and quizzes
│   │   └── whs-drafts/page.js            Optional future Staff WHS drafting entry
│   └── api/
│       ├── auth/
│       │   └── clear-password-flag/route.js
│       ├── admin/
│       │   ├── invite-staff/route.js
│       │   ├── staff/route.js
│       │   └── onboarding/route.js       Future protected onboarding create/assign endpoint
│       ├── quizzes/
│       │   └── grade/route.js            Existing grade-quiz endpoint moved without changing logic
│       └── whs-drafts/
│           └── [draftId]/
│               └── risk-rows/route.js    Future protected GET/PUT numbered hazard rows
├── components/
│   ├── layout/
│   │   ├── AppShell.js                   Header, logo, settings and logout controls
│   │   ├── AdminNavigation.js            Administrator-only task cards and navigation
│   │   └── StaffNavigation.js            Staff-only personal-work navigation
│   ├── admin/
│   │   ├── StaffProgressDashboard.js     Extract from OnboardingWorkbook.js
│   │   ├── StaffAccessPanel.js           Extract the invite/reset/Admin-access controls
│   │   ├── DraftOnboardingPanel.js       Extract from AssignedOnboarding.js
│   │   └── ResourceLibraryAdmin.js       Editable resource/capability controls
│   ├── staff/
│   │   ├── MyOnboardingWorkspace.js      Extract the Staff-assigned onboarding view
│   │   ├── LearningWorkspace.js          Training library and quiz entry points
│   │   └── ProfileDetails.js             Staff employee-details first step
│   ├── learning/
│   │   ├── Quiz.js                       Existing quiz component
│   │   ├── TrainingLibrary.js            Existing read-only capability content
│   │   └── ResourceLibrary.js            Existing library reader, Staff read-only by default
│   ├── whs/
│   │   ├── NumberedSwmsRows.js           Controlled numbered hazard/factor input rows
│   │   └── SwmsDraftForm.js              Future parent form and submission handler
│   └── shared/
│       ├── SettingsMenu.js               Keep Change password and Log out available to everyone
│       ├── EmptyState.js
│       └── LoadingState.js
├── lib/
│   ├── auth/
│   │   ├── AuthProvider.js               Existing provider, moved unchanged
│   │   ├── roles.js                      isAdmin / canAccess helpers
│   │   └── requireRole.js                Server-side API role guard
│   ├── supabase/
│   │   ├── client.js                     Browser client (from supabaseClient.js)
│   │   ├── server.js                     Server-side admin client; never expose service role key
│   │   └── queries.js                    Data reads/writes split from the large data.js file
│   ├── onboarding/
│   │   ├── data.js                       Checklist, module, progress and sign-off data functions
│   │   └── capabilityData.json           Existing capability framework
│   ├── whs/
│   │   ├── riskRows.js                   Row normalisation and validation helpers
│   │   └── draftPayload.js               Draft payload builder shared by form/API tests
│   └── storage.js                        Existing managed-file helpers
├── sql/
│   ├── 2026-staff-progress.sql           Existing applied progress schema—do not rewrite
│   ├── 2026-onboarding-access.sql        Future access-role migration, if required
│   └── 2026-whs-risk-rows.sql            Future numbered SWMS risk-row migration
├── Modules/                              Existing source learning PDFs
├── public/
│   ├── logo.png                          Existing Ecology Consulting logo
│   ├── favicon.ico                       Existing favicon
│   └── ecology/                          Optimised native flora/fauna images, if local assets are used
├── docs/
│   ├── GIT_FILE_LAYOUT_MAP.md
│   ├── EXACT_BUILD_AND_SWMS_CHANGES.md
│   └── RECOMMENDED_UPDATED_STRUCTURE.md
├── instrumentation.js                    Keep Sentry server hook
├── instrumentation-client.js             Keep Sentry browser hook
├── sentry.server.config.js
├── sentry.edge.config.js
├── next.config.js
├── package.json
└── package-lock.json
```

## What stays exactly where it is first

| Current file | First safe action | Why |
|---|---|---|
| `app/login/page.js` | Keep in place; update styling only after the password-reset provider is corrected. | It contains the password/email-link flow and the reported SMTP error originates here. |
| `app/change-password/page.js` | Keep in place unchanged. | Every user must keep control of their own password. |
| `app/reset-password/page.js` | Keep in place unchanged. | This is the destination for a Supabase email reset link. |
| `lib/AuthProvider.js` | Move only after importing it through a compatibility re-export. | It controls existing sessions, role state and forced password changes. |
| `lib/data.js` | Split gradually by feature; retain a re-export wrapper until all callers move. | This avoids breaking the large workbook during incremental work. |
| `components/OnboardingWorkbook.js` | Do not rewrite in one operation. First extract navigation, then admin panels, then staff panels. | It currently contains the working interaction logic. |

## Role boundary map

| Area | Administrator | Staff |
|---|---:|---:|
| Staff Progress | Full access | No access |
| Draft Onboarding | Create, edit, lock and assign | No access |
| Staff access / Administrator access | Manage | No access |
| Resource and capability editing | Manage | Read approved content only |
| My Onboarding | View an assigned person only for support | View and update own only |
| Change password | Own account only | Own account only |
| Log out | Own session | Own session |
| Numbered SWMS drafting | Review/publish only if this module is added | Create own working draft only |

## Safe migration order

1. Repair the Vercel build by adding `@sentry/nextjs`, regenerating `package-lock.json`, and verifying `npm run build`.
2. Add `lib/auth/roles.js` and use it in new routes before moving any existing screen.
3. Create the `/admin` and `/staff` entry pages, but initially render the existing working modules beneath those pages.
4. Extract one stable component at a time from `OnboardingWorkbook.js`; retain imports/re-export wrappers until its callers are moved.
5. Move data functions from `lib/data.js` by domain, without changing Supabase table names or row-level security policies in the same change.
6. Add the numbered SWMS row tables and APIs only when the SWMS draft screen is ready; this functionality is not required to keep existing onboarding working.
7. Validate Administrator, Staff, password-change, logout and reset-password flows before deploying to `on-boarding-ivory.vercel.app`.

## Do not copy directly from the Staff Portal

The Ecology Staff Portal uses React/Vite, Express, tRPC, Drizzle/MySQL and Manus OAuth. This OnBoarding project uses Next.js, Supabase and Supabase authentication. Copy the **design language, progressive navigation and role boundaries**, but do not copy the Staff Portal’s authentication, database client, tRPC router or Drizzle code into this repository.
