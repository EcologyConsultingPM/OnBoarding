import * as Sentry from "@sentry/nextjs";

// Does nothing at all until NEXT_PUBLIC_SENTRY_DSN is set — safe to ship
// before Aaron has created a Sentry account, and starts working the
// moment the env var is added, no code changes needed.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
