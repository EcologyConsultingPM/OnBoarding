const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Safe with zero Sentry configuration at all — source map upload is
// skipped silently if SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN aren't
// set, which just means error stack traces won't be de-minified until
// those are added. Nothing about the app itself depends on this.
module.exports = withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  sourcemaps: {
    disable: true,
  },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
