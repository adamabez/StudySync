// StudySync - routes that work without logging in: the pages themselves, the login /
// sign-up / password forms, starting and ending the demo, and feedback from any page.
//
// ctx (from server.js): { req, res, url, loggedIn, inDemo, demoMode, endDemo }
//   inDemo   → trying the demo (no account, sample data; a real login always wins)
//   demoMode → like inDemo, but "embed" inside the welcome page's live demo box (no banner)
//   endDemo(cookies) → adds the cookie that ends the demo, if there is one

const auth = require("../lib/auth");
const ai = require("../lib/ai");
const feedback = require("../lib/feedback");
const onboarding = require("../lib/onboarding");
const demo = require("../lib/demo");
const { siteUrl, sendPage, sendJson, redirect, readBody, readJson } = require("../lib/http");
const { feedbackLimited } = require("../lib/limits");

// Pages only for students with an account or a demo (others go to the login page)
const appPage = (fileName, { demoBanner = "full" } = {}) => ({ res, loggedIn, inDemo, demoMode }) => {
  if (!loggedIn && !inDemo) return redirect(res, "/login");
  sendPage(res, fileName, 200, demoBanner === "full" ? inDemo : demoMode);
};

module.exports = [
  // "Try the demo" (the welcome page's buttons, or a QR code pointing here): straight to the
  // landing page with a sample student's week, no sign-up.
  // The welcome page's live demo box loads /demo?embed=1&to=landing in a frame: same demo,
  // without the banner.
  ["GET", "/demo", ({ res, url, loggedIn, inDemo }) => {
    const embed = url.searchParams.get("embed") === "1";
    const target = (url.searchParams.get("to") === "dashboard" ? "/dashboard" : "/landing") + (embed ? "?embed=1" : "");
    if (loggedIn) return redirect(res, "/home");
    if (inDemo) return redirect(res, target);
    redirect(res, target, { "Set-Cookie": demo.startCookie(demo.start()) });
  }],

  // Whether to show the "Demo version" AI notice on login / sign-up
  ["GET", "/ai-status", ({ res }) => {
    sendJson(res, { freeTier: ai.providerInfo().freeTier }); // shown even before the key is added
  }],

  // Front page: what StudySync is, with the live demo and sign-up (skipped if logged in).
  // Older links (email confirmation, errors, "account deleted") pointed at /?..., so those
  // go to the login page with the same query; the browser keeps any #... part.
  ["GET", "/", ({ res, url, loggedIn }) => {
    if (loggedIn) return redirect(res, "/home");
    if (["error", "checkEmail", "confirmed", "deleted"].some((key) => url.searchParams.has(key))) {
      return redirect(res, "/login" + url.search);
    }
    sendPage(res, "welcome.html");
  }],

  ["GET", "/login", ({ res, loggedIn }) => {
    if (loggedIn) return redirect(res, "/home");
    sendPage(res, "login.html");
  }],

  ["POST", "/login", ({ req, res, endDemo }) => readBody(req, res, 10_000, async (body) => {
    const form = new URLSearchParams(body);
    const result = await auth.logIn((form.get("email") || "").trim(), form.get("password") || "");
    if (result.error) return redirect(res, `/login?error=${result.error}`);
    redirect(res, "/home", { "Set-Cookie": endDemo(result.cookies) });
  })],

  ["GET", "/signup", ({ res, loggedIn }) => {
    if (loggedIn) return redirect(res, "/home");
    sendPage(res, "signup.html");
  }],

  ["POST", "/signup", ({ req, res, endDemo }) => readBody(req, res, 10_000, async (body) => {
    const form = new URLSearchParams(body);
    const name = onboarding.cleanName(form.get("name"));
    if (name.error) return redirect(res, `/signup?error=${name.code}`);
    const result = await auth.signUp((form.get("email") || "").trim(), form.get("password") || "", name.value, `${siteUrl(req)}/?confirmed=1`);
    if (result.error) return redirect(res, `/signup?error=${result.error}`);
    if (result.confirmEmail) return redirect(res, "/login?checkEmail=1");
    redirect(res, "/home", { "Set-Cookie": endDemo(result.cookies) });
  })],

  // Loading screen, then the dashboard (logged-in users only)
  ["GET", "/home", ({ res, loggedIn, inDemo }) => {
    if (inDemo) return redirect(res, "/landing");
    if (!loggedIn) return redirect(res, "/login");
    sendPage(res, "loading.html");
  }],

  // After the loading screen: first login → the schedule screen, otherwise → the dashboard.
  // (Finishing the schedule screen shows the landing page once: study plan + groups.)
  ["GET", "/start", async ({ req, res, loggedIn, inDemo }) => {
    if (inDemo) return redirect(res, "/landing");
    if (!loggedIn) return redirect(res, "/login");
    try {
      const profile = await onboarding.getProfile(auth.supabaseFor(req), auth.getUserId(req));
      redirect(res, profile.onboarded ? "/dashboard" : "/setup");
    } catch (error) {
      // Usually means the profiles table doesn't exist yet: run supabase/schema.sql again
      console.error("Couldn't check first-login setup (run supabase/schema.sql again?):", error.message || error);
      redirect(res, "/dashboard");
    }
  }],

  ["GET", "/setup", appPage("setup.html")], // "Edit schedule" works in the demo too (always with the banner)
  ["GET", "/landing", appPage("landing.html", { demoBanner: "auto" })],
  ["GET", "/dashboard", appPage("dashboard.html", { demoBanner: "auto" })],
  ["GET", "/group", appPage("group.html", { demoBanner: "auto" })], // one study group: /group?id=<group id>

  // Account settings: change email / password, dark mode, delete account
  ["GET", "/account", ({ res, loggedIn, inDemo }) => {
    if (inDemo) return redirect(res, "/signup"); // no account to change in the demo
    if (!loggedIn) return redirect(res, "/login");
    sendPage(res, "account.html");
  }],

  // Forgot password: ask for the email, then Supabase emails a reset link
  ["GET", "/forgot", ({ res }) => sendPage(res, "forgot.html")],

  ["POST", "/forgot", ({ req, res }) => readBody(req, res, 10_000, async (body) => {
    const email = (new URLSearchParams(body).get("email") || "").trim();
    // The link in the email comes back here. Supabase only allows addresses listed
    // under Authentication → URL Configuration → Redirect URLs.
    const result = await auth.sendPasswordReset(email, `${siteUrl(req)}/reset-password`);
    redirect(res, result.error ? `/forgot?error=${result.error}` : "/forgot?sent=1");
  })],

  // The reset link lands here. The page reads the login from the URL and sends it back with the new password.
  ["GET", "/reset-password", ({ res }) => sendPage(res, "reset-password.html")],

  ["POST", "/reset-password", ({ req, res }) => readJson(req, res, 20_000, async (input) => {
    const text = (value) => (typeof value === "string" ? value : "");
    if (text(input.password).length < 6) return sendJson(res, { error: "weak" }, 400);
    const result = await auth.resetPassword(text(input.accessToken), text(input.refreshToken), text(input.password));
    if (result.error) return sendJson(res, { error: result.error }, 400);
    res.setHeader("Set-Cookie", result.cookies);
    sendJson(res, { ok: true });
  })],

  // Log out → the login page. Also ends the demo: "Exit demo" in the demo banner comes
  // here, and goes back to the welcome page.
  ["GET", "/logout", async ({ req, res, loggedIn, endDemo }) => {
    const wasDemo = !loggedIn && demo.hasDemo(req);
    if (demo.hasDemo(req)) demo.end(req);
    redirect(res, wasDemo ? "/" : "/login", { "Set-Cookie": endDemo(await auth.logOut(req)) });
  }],

  // Feedback / bug reports / feature ideas: from every page, account or not.
  // Logged in: saved as that user, with their email. Otherwise (welcome / login page, the demo):
  // saved without a user, with an email only if they typed one, and rate limited.
  ["POST", "/api/feedback", ({ req, res, loggedIn, inDemo }) => readJson(req, res, 20_000, async (input) => {
    if (!loggedIn && feedbackLimited(req)) {
      return sendJson(res, { error: "Thanks for all the feedback! Wait a few minutes before sending more." }, 429);
    }
    const email = req.user ? req.user.email : (typeof input.email === "string" ? input.email.trim() : "");
    if (!loggedIn && email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return sendJson(res, { error: "That email doesn't look right. Leave it empty if you'd rather not share it." }, 400);
    }
    const page = (inDemo ? "[demo] " : "") + (typeof input.page === "string" ? input.page : "");
    try {
      const result = await feedback.addFeedback(auth.supabaseFor(req), { ...input, page }, req.headers["user-agent"], email);
      if (result.error) return sendJson(res, { error: result.error }, 400);
    } catch (error) {
      // Without an account this needs the newest supabase/schema.sql (feedback without a user)
      console.error("Feedback failed" + (loggedIn ? "" : " (no account: run supabase/feedback-anonymous.sql in Supabase)") + ":", error.message || error);
      return sendJson(res, { error: "Couldn't send that right now. Try again in a bit." }, 502);
    }
    sendJson(res, { ok: true }, 201);
  })],
];
