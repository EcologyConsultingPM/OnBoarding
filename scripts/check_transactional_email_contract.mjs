import assert from "node:assert/strict";
import { renderPortalEmail } from "../lib/transactionalEmail.js";

const html = renderPortalEmail({
  subject: "Service request received",
  heading: "Your service request has been received",
  body: "Your request is awaiting administrator review.",
  ctaLabel: "View your request",
  actionUrl: "https://portal.example.test/staff/service-requests",
});

assert.match(html, /role="presentation"/, "Email layout must use client-safe presentation tables.");
assert.match(html, /background-color:#123b2a/, "The header must use a solid high-contrast green fill.");
assert.match(html, /color:#ffffff/, "Header text and action text must remain high contrast.");
assert.match(html, /background-color:#a67418/, "The action must use a solid accessible gold fill.");
assert.match(html, /color:#1e2e26/, "Body copy must retain a professional dark text colour.");
assert.match(html, /background-color:#e7eee7/, "The operational footer requires a visible contrasting panel.");
assert.match(html, /color:#40564a/, "Footer copy must not use a pale, low-contrast font colour.");
assert.doesNotMatch(html, /linear-gradient/i, "Email clients must not depend on gradient support for the design.");
assert.match(html, /View your request/, "The action label must be retained.");
assert.match(html, /https:\/\/portal\.example\.test\/staff\/service-requests/, "The action URL must be retained.");

console.log("Transactional email contrast contract passed.");
