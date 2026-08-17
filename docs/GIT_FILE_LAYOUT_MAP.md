[GIT_FILE_LAYOUT_MAP.md](https://github.com/user-attachments/files/31125844/GIT_FILE_LAYOUT_MAP.md)
# Ecology Consulting OnBoarding — Git File Layout Map

This repository is the source project for the Ecology Consulting onboarding application. The intended production domain is **`https://on-boarding-ivory.vercel.app/`**. It is a separate Next.js and Supabase application from the Ecology Consulting Staff Portal.

> **Before editing:** the currently connected Vercel project has a failed build because `next.config.js` imports `@sentry/nextjs`, but `package.json` does not list that dependency. Correct that dependency issue before expecting a fresh deployment to succeed.

## Top-level layout

```text
OnBoarding/
├── app/                         Next.js routes, page shells, global styling and API routes
├── components/                  Large interactive React components for onboarding and learning
├── lib/                         Authentication, Supabase data access and capability content
├── Modules/                     Source learning PDFs used as training resources
├── public/                      Public logo and favicon assets
├── sql/                         Supabase database schema / setup script
├── instrumentation*.js          Browser and server monitoring entry points
├── sentry.*.config.js           Sentry runtime configuration
├── next.config.js               Next.js and Sentry build configuration
├── package.json                 Application dependencies and scripts
└── package-lock.json            Locked dependency versions for Vercel builds
```

## Routes and pages

| Path | Purpose | Who should use or edit it |
|---|---|---|
| `app/page.js` | Authenticated root. Checks session and forced password change, then opens the relevant onboarding workspace. | Change only when altering the post-login entry flow. |
| `app/login/page.js` | Role picker and sign-in interface. Supports password, email-link and Forgot password flows. | Edit wording, role-choice layout or authentication UX here. SMTP/Supabase reset failures originate through this flow. |
| `app/change-password/page.js` | Signed-in user self-service password update screen. | Keep available to every signed-in user; it changes only the caller’s own password. |
| `app/reset-password/page.js` | Destination for a password-reset email link. | Do not remove unless the Supabase password-reset approach is replaced deliberately. |
| `app/layout.js` | Root HTML layout and application-wide providers. | Use for fonts, metadata and global wrappers. |
| `app/globals.css` | Global CSS, responsive rules and shared visual treatments. | Main location to apply the Staff Portal ecology design tokens and native imagery treatments. |
| `app/icon.png` | App-router icon used by Next.js. | Update only with a matching branded icon. |

## Administrator API routes

| Path | Function | Access boundary |
|---|---|---|
| `app/api/admin/invite-staff/route.js` | Creates or resets Staff access and issues the temporary-password onboarding path. | **Administrator only.** This supports “Set up a new staff member”. |
| `app/api/admin/staff/route.js` | Supplies roster and per-person progress for the Staff Progress view. | **Administrator only.** |
| `app/api/clear-password-flag/route.js` | Clears the forced password-change flag for the current person after they set their own password. | Own account only. |
| `app/api/grade-quiz/route.js` | Grades quiz attempts and records outcomes. | Called from the learning workflow; preserve validation and server-side checks. |

## Main interactive components

| File | Responsibility | Suggested destination / role boundary |
|---|---|---|
| `components/OnboardingWorkbook.js` | Primary application interface. Contains the navigation, Administrator tools, Staff onboarding worksheet, progress handling, sign-offs, role-aware editing and Settings/logout controls. | Keep **Staff Progress**, **Draft Onboarding**, Administrator access and editable administrative controls Administrator-only. Keep **My Onboarding** personal to the signed-in Staff member. This is the main file for the task-first navigation redesign. |
| `components/AssignedOnboarding.js` | Draft-onboarding creation and Staff-assigned onboarding experience. | **Draft Onboarding** is Administrator-only; **My Onboarding** is Staff-only. |
| `components/ResourceLibrary.js` | Career levels, capability framework, resource folders and editable learning resources. | Administrator-managed editing; Staff read-only access where approved. |
| `components/TrainingLibrary.js` | Read-only training/capability reference content. | Suitable for Staff learning and Administrator reference. |
| `components/Quiz.js` | Quiz delivery, answer capture and outcome display. | Staff complete assigned quizzes; Admin review occurs through the relevant progress/module workflows. |

## Data, authentication and content

| File | Responsibility | Editing guidance |
|---|---|---|
| `lib/AuthProvider.js` | React authentication context, role state, session handling and forced-password-change state. | Do not replace with the Staff Portal’s Manus OAuth code; this project uses Supabase. |
| `lib/supabaseClient.js` | Supabase browser-client initialisation. | Supabase URL/key must be configured through Vercel environment variables, not committed to Git. |
| `lib/data.js` | All Supabase reads and writes for onboarding content, Staff progress, resources, modules, sign-offs and related records. | Update this with database changes; keep access filtering in place. |
| `lib/capabilityData.json` | Capability framework, career levels and training guidance. | Administrator-owned source content for the Resource Library and capability views. |
| `lib/storage.js` | Storage helpers for uploaded resource files. | Use for documents rather than embedding file bytes in the database. |

## Assets, learning material and database

| Path | Responsibility | Editing guidance |
|---|---|---|
| `Modules/Flora/*.pdf` | Supplied flora-training source material. | Keep source PDFs intact; use them as module resources or quiz inputs. |
| `public/logo.png` | Public Ecology Consulting logo. | Keep as the main application brand asset. |
| `public/favicon.ico` | Browser favicon. | Replace only with a matching branded favicon. |
| `sql/2026-staff-progress.sql` | Supabase schema for Staff progress and onboarding records. | Apply changes through Supabase migration workflow; do not manually alter production tables without a reviewed migration. |

## Build and monitoring files

| File | Purpose | Current note |
|---|---|---|
| `package.json` | Next.js, React, Supabase and other dependencies. | Add `@sentry/nextjs` before the next Vercel build, or remove the Sentry wrapper from `next.config.js` only if monitoring is intentionally retired. |
| `package-lock.json` | Exact dependency lockfile used by Vercel. | Regenerate whenever `package.json` changes. |
| `next.config.js` | Wraps Next.js configuration using `withSentryConfig`. | Current production build fails because the referenced Sentry package is absent. |
| `instrumentation.js` | Server-side Sentry registration hook. | Keep aligned with the installed Sentry package and Next.js version. |
| `instrumentation-client.js` | Browser-side Sentry initialisation. | Keep browser monitoring keys in environment variables. |
| `sentry.server.config.js` | Sentry server/runtime configuration. | Do not commit DSNs or auth tokens. |
| `sentry.edge.config.js` | Sentry edge-runtime configuration. | Keep compatible with Next.js deployment targets. |

## Safe update sequence

1. **Fix the build first.** Add the missing `@sentry/nextjs` dependency and refresh `package-lock.json`, then run `npm run build` locally before deploying.
2. **Preserve personal controls.** Keep Change password and Log out visible to every signed-in person; they operate only on the caller’s own session/account.
3. **Keep roles explicit.** Administrator navigation contains Staff Progress, Draft Onboarding, Staff-access setup, Administrator access and editable resources. Staff navigation contains My Onboarding, assigned modules/quizzes and read-only approved resources.
4. **Apply the visual change centrally.** Start in `app/globals.css`, `app/layout.js` and the navigation section of `components/OnboardingWorkbook.js`; preserve the data and permission behaviour in `lib/` and `app/api/` unless changing a defined workflow.
5. **Deploy only to the existing intended project/domain.** Confirm the Vercel project and alias before promoting a build to production, so `on-boarding-ivory.vercel.app` remains the chosen public entry point.

