// StudySync - API: account settings (lib/auth.js) and who's logged in.
// Every API route gets ctx = { req, res, url, params, db, userId }: db runs queries as the
// logged-in student, so they only ever see their own data.

const auth = require("../lib/auth");
const materials = require("../lib/materials");
const onboarding = require("../lib/onboarding");
const { sendJson, readJson } = require("../lib/http");

// Changing the account needs the current password; these explain what went wrong
const ACCOUNT_ERRORS = {
  invalid: "That password isn't right.",
  weak: "Pick a new password with at least 6 characters.",
  same: "That's already your password. Pick a different one.",
  email: "That email address doesn't look right.",
  sameemail: "That's already your email.",
  exists: "There's already an account with that email.",
  rate: "Too many tries. Wait a minute and try again.",
  unreachable: "Couldn't reach the login service. Try again.",
};
const accountError = (code) => ({ error: ACCOUNT_ERRORS[code] || "Something went wrong. Try again." });

module.exports = [
  ["POST", "/api/account/password", ({ req, res }) => readJson(req, res, 10_000, async (input) => {
    const result = await auth.changePassword(req, input.currentPassword, input.newPassword);
    if (result.error) return sendJson(res, accountError(result.error), 400);
    res.setHeader("Set-Cookie", result.cookies);
    sendJson(res, { ok: true });
  })],

  ["POST", "/api/account/email", ({ req, res }) => readJson(req, res, 10_000, async (input) => {
    const result = await auth.changeEmail(req, input.password, input.email);
    if (result.error) return sendJson(res, accountError(result.error), 400);
    sendJson(res, result);
  })],

  ["POST", "/api/account/delete", ({ req, res, db }) => readJson(req, res, 10_000, async (input) => {
    if (input.confirm !== "DELETE") return sendJson(res, { error: "Type DELETE to confirm." }, 400);
    const result = await auth.deleteAccount(req, input.password, async () => {
      // PDFs live in Storage, which doesn't clean up by itself: remove them first
      for (const source of await materials.listSources(db)) await materials.removeSource(db, source.id);
    });
    if (result.error) return sendJson(res, accountError(result.error), 400);
    res.setHeader("Set-Cookie", result.cookies);
    sendJson(res, { ok: true });
  })],

  // "Logged in as ..." on the dashboard
  ["GET", "/api/me", async ({ req, res, db, userId }) => {
    const profile = await onboarding.getProfile(db, userId);
    sendJson(res, { email: req.user.email, name: onboarding.displayName(profile, req.user) });
  }],
];
