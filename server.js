// StudySync - the server: starts it up and decides what each URL shows.
// Run with:  node --watch server.js   (or press F5 in VS Code)
// Then open: http://localhost:3000
//
// Where everything lives:
//   server.js     → this file: starts the server + routes (which URL does what)
//   auth.js       → login with Supabase and who's logged in
//   schedule.js   → saving / loading calendar items (Supabase)
//   materials.js  → saving / loading Virtual Notebook materials (Supabase)
//   chats.js      → saved Virtual Notebook chats (Supabase)
//   ai.js         → asking the AI about those materials (Gemini or Claude: ai-gemini.js / ai-anthropic.js)
//   feedback.js   → feedback / bug reports from the dashboard (Supabase)
//   canvas.js     → linking Canvas and loading homework (missing / completed / upcoming)
//   onboarding.js → first-login schedule screen, "study alone or in a group?", weekly study goal
//   groups.js     → study groups (students are matched automatically by schedule, one group per class)
//   courses.js    → the Sac State course catalog students pick their classes from
//   sections.js   → each class's sections (days, times, room) from Sac State's class schedule
//   studyplan.js  → weekly study times: picked by the AI if there's a key, else by public/planner.js
//   demo.js       → "Try the demo": the real pages with sample data, no account needed
//   pages/        → the HTML for each page
//   public/       → CSS and browser JavaScript the pages load
//   .env          → your secret keys: Supabase, Gemini or Anthropic (never commit this!)

const http = require("http");
const fs = require("fs");
const path = require("path");

// Load secrets (SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY) from .env, if that file exists
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // no .env yet → nobody can log in until the Supabase keys are added
}

const auth = require("./auth");
const schedule = require("./schedule");
const materials = require("./materials");
const chats = require("./chats");
const ai = require("./ai");
const feedback = require("./feedback");
const canvas = require("./canvas");
const onboarding = require("./onboarding");
const groups = require("./groups");
const meetups = require("./meetups");
const courses = require("./courses");
const studylog = require("./studylog");
const sections = require("./sections");
const studyplan = require("./studyplan");
const demo = require("./demo");

// Hosts like Render choose the port and pass it in PORT; on your computer it's 3000
const PORT = Number(process.env.PORT) || 3000;

// The site's public address, for links in emails (password reset). Set PUBLIC_URL in .env
// (or the host's settings) when it's online, e.g. https://studysync.onrender.com. Otherwise
// it's worked out from the request (http://localhost:3000 on your computer).
function siteUrl(req) {
  const fromEnv = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${req.headers.host}`;
}

// ---------- Helpers for sending responses ----------

// Send one of the HTML files from the pages/ folder
// (inDemo adds the "You're trying a demo" banner; "embed" is the login page's live preview)
function sendPage(res, fileName, status = 200, inDemo = false) {
  let html = fs.readFileSync(path.join(__dirname, "pages", fileName), "utf8");
  if (inDemo === "embed") html = demo.forPreview(html);
  else if (inDemo) html = demo.withBanner(html);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

// Send a CSS or JS file from the public/ folder (e.g. /public/style.css)
const FILE_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendPublicFile(res, urlPath) {
  const fileName = path.basename(urlPath); // basename blocks tricks like /public/../server.js
  const type = FILE_TYPES[path.extname(fileName)];
  const filePath = path.join(__dirname, "public", fileName);
  if (!type || !fs.existsSync(filePath)) return sendPage(res, "404.html", 404);
  res.writeHead(200, { "Content-Type": type });
  res.end(fs.readFileSync(filePath));
}

// Something went wrong (usually talking to Supabase): log it, and tell the browser
function handleError(res, error) {
  console.error("Request failed:", error);
  if (res.headersSent) return res.end();
  sendJson(res, { error: "Something went wrong saving or loading your data. Try again." }, 500);
}

// Collect the data a browser sends with a POST request (up to `limit` characters)
function readBody(req, res, limit, callback) {
  let body = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    if (tooBig) return;
    body += chunk;
    if (body.length > limit) tooBig = true;
  });
  req.on("end", () => {
    if (tooBig) return sendJson(res, { error: "That's too big to send." }, 413);
    Promise.resolve()
      .then(() => callback(body))
      .catch((error) => handleError(res, error));
  });
}

// Same as readBody, but parses JSON (replies "Bad request" if it isn't valid JSON)
function readJson(req, res, limit, callback) {
  readBody(req, res, limit, (body) => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return sendJson(res, { error: "Bad request" }, 400);
    }
    return callback(data && typeof data === "object" ? data : {});
  });
}

// Meetup changes (spots, votes, RSVPs, moving a session): at most WRITE_LIMIT a minute per student
const WRITE_LIMIT = 30;
const writeTimes = new Map(); // user ID → [times]
function writeAllowed(userId) {
  const since = Date.now() - 60 * 1000;
  const times = (writeTimes.get(userId) || []).filter((t) => t > since);
  if (writeTimes.size > 5_000) writeTimes.clear();
  if (times.length >= WRITE_LIMIT) return false;
  writeTimes.set(userId, [...times, Date.now()]);
  return true;
}

// Feedback without an account: at most FEEDBACK_LIMIT messages per visitor (IP) every 10 minutes
const FEEDBACK_LIMIT = 5;
const feedbackTimes = new Map(); // ip → [times]
function feedbackLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const since = Date.now() - 10 * 60 * 1000;
  const times = (feedbackTimes.get(ip) || []).filter((t) => t > since);
  if (feedbackTimes.size > 5_000) feedbackTimes.clear(); // never grows without limit
  if (times.length >= FEEDBACK_LIMIT) return true;
  feedbackTimes.set(ip, [...times, Date.now()]);
  return false;
}

// ---------- Routes: which URL shows what ----------
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => handleError(res, error));
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CSS and browser JavaScript (no login check needed)
  if (req.method === "GET" && url.pathname.startsWith("/public/")) {
    return sendPublicFile(res, url.pathname);
  }

  // Who's logged in? After this, auth.getUserId(req) gives their Supabase user ID
  await auth.loadUser(req, res);
  const loggedIn = auth.isLoggedIn(req);
  // Trying the demo (demo.js): no account, sample data. A real login always wins.
  const inDemo = !loggedIn && demo.hasDemo(req);
  // Logging in, signing up or logging out also ends the demo
  // The login page's live demo box: the demo without its banner. It starts at ?embed=1;
  // pages visitors click to inside the box stay embedded (browsers mark frame loads with
  // Sec-Fetch-Dest: iframe), so the banner never shows up inside it.
  const inFrame = url.searchParams.get("embed") === "1" || req.headers["sec-fetch-dest"] === "iframe";
  const demoMode = inDemo && inFrame ? "embed" : inDemo;
  const endDemo = (cookies) => (demo.hasDemo(req) ? [...[].concat(cookies), demo.clearCookie()] : cookies);

  // "Try the demo" (the login page's button, or a QR code pointing here): straight to the
  // landing page with a sample student's week, no sign-up
  // The login page's live preview loads /demo?embed=1&to=dashboard in a frame: same demo,
  // without the banner.
  if (req.method === "GET" && url.pathname === "/demo") {
    const embed = url.searchParams.get("embed") === "1";
    const target = (url.searchParams.get("to") === "dashboard" ? "/dashboard" : "/landing") + (embed ? "?embed=1" : "");
    if (loggedIn) return redirect(res, "/home");
    if (inDemo) return redirect(res, target);
    return redirect(res, target, { "Set-Cookie": demo.startCookie(demo.start()) });
  }

  // Whether to show the "Demo version" AI notice on login / sign-up (no login needed)
  if (req.method === "GET" && url.pathname === "/ai-status") {
    return sendJson(res, { freeTier: ai.providerInfo().freeTier }); // shown even before the key is added
  }

  // Front page: the login form (skip it if already logged in)
  if (req.method === "GET" && url.pathname === "/") {
    if (loggedIn) return redirect(res, "/home");
    return sendPage(res, "login.html");
  }

  // The login form submits here
  if (req.method === "POST" && url.pathname === "/login") {
    return readBody(req, res, 10_000, async (body) => {
      const form = new URLSearchParams(body);
      const result = await auth.logIn((form.get("email") || "").trim(), form.get("password") || "");
      if (result.error) return redirect(res, `/?error=${result.error}`);
      redirect(res, "/home", { "Set-Cookie": endDemo(result.cookies) });
    });
  }

  // Sign-up page, and the sign-up form submits here
  if (req.method === "GET" && url.pathname === "/signup") {
    if (loggedIn) return redirect(res, "/home");
    return sendPage(res, "signup.html");
  }

  if (req.method === "POST" && url.pathname === "/signup") {
    return readBody(req, res, 10_000, async (body) => {
      const form = new URLSearchParams(body);
      const name = onboarding.cleanName(form.get("name"));
      if (name.error) return redirect(res, `/signup?error=${name.code}`);
      const result = await auth.signUp((form.get("email") || "").trim(), form.get("password") || "", name.value, `${siteUrl(req)}/?confirmed=1`);
      if (result.error) return redirect(res, `/signup?error=${result.error}`);
      if (result.confirmEmail) return redirect(res, "/?checkEmail=1");
      redirect(res, "/home", { "Set-Cookie": endDemo(result.cookies) });
    });
  }

  // Loading screen, then the dashboard (logged-in users only)
  if (req.method === "GET" && url.pathname === "/home") {
    if (inDemo) return redirect(res, "/landing");
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "loading.html");
  }

  // After the loading screen: first login → the schedule screen, otherwise → the dashboard.
  // (Finishing the schedule screen shows the landing page once: study plan + groups.)
  if (req.method === "GET" && url.pathname === "/start") {
    if (inDemo) return redirect(res, "/landing");
    if (!loggedIn) return redirect(res, "/");
    try {
      const profile = await onboarding.getProfile(auth.supabaseFor(req), auth.getUserId(req));
      return redirect(res, profile.onboarded ? "/dashboard" : "/setup");
    } catch (error) {
      // Usually means the profiles table doesn't exist yet: run supabase/schema.sql again
      console.error("Couldn't check first-login setup (run supabase/schema.sql again?):", error.message || error);
      return redirect(res, "/dashboard");
    }
  }

  if (req.method === "GET" && url.pathname === "/setup") {
    if (!loggedIn && !inDemo) return redirect(res, "/");
    return sendPage(res, "setup.html", 200, inDemo); // "Edit schedule" works in the demo too
  }

  if (req.method === "GET" && url.pathname === "/landing") {
    if (!loggedIn && !inDemo) return redirect(res, "/");
    return sendPage(res, "landing.html", 200, demoMode);
  }

  if (req.method === "GET" && url.pathname === "/dashboard") {
    if (!loggedIn && !inDemo) return redirect(res, "/");
    return sendPage(res, "dashboard.html", 200, demoMode);
  }

  // Account settings: change email / password, dark mode, delete account
  if (req.method === "GET" && url.pathname === "/account") {
    if (inDemo) return redirect(res, "/signup"); // no account to change in the demo
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "account.html");
  }

  // One study group's page: /group?id=<group id>
  if (req.method === "GET" && url.pathname === "/group") {
    if (!loggedIn && !inDemo) return redirect(res, "/");
    return sendPage(res, "group.html", 200, demoMode);
  }

  // Log out
  // Forgot password: ask for the email, then Supabase emails a reset link
  if (req.method === "GET" && url.pathname === "/forgot") {
    return sendPage(res, "forgot.html");
  }

  if (req.method === "POST" && url.pathname === "/forgot") {
    return readBody(req, res, 10_000, async (body) => {
      const email = (new URLSearchParams(body).get("email") || "").trim();
      // The link in the email comes back here. Supabase only allows addresses listed
      // under Authentication → URL Configuration → Redirect URLs.
      const result = await auth.sendPasswordReset(email, `${siteUrl(req)}/reset-password`);
      redirect(res, result.error ? `/forgot?error=${result.error}` : "/forgot?sent=1");
    });
  }

  // The reset link lands here. The page reads the login from the URL and sends it back with the new password.
  if (req.method === "GET" && url.pathname === "/reset-password") {
    return sendPage(res, "reset-password.html");
  }

  if (req.method === "POST" && url.pathname === "/reset-password") {
    return readJson(req, res, 20_000, async (input) => {
      const text = (value) => (typeof value === "string" ? value : "");
      if (text(input.password).length < 6) return sendJson(res, { error: "weak" }, 400);
      const result = await auth.resetPassword(text(input.accessToken), text(input.refreshToken), text(input.password));
      if (result.error) return sendJson(res, { error: result.error }, 400);
      res.setHeader("Set-Cookie", result.cookies);
      sendJson(res, { ok: true });
    });
  }

  // (also ends the demo: "Exit demo" in the demo banner comes here)
  if (req.method === "GET" && url.pathname === "/logout") {
    if (demo.hasDemo(req)) demo.end(req);
    return redirect(res, "/", { "Set-Cookie": endDemo(await auth.logOut(req)) });
  }

  // --- Feedback / bug reports / feature ideas: from every page, account or not ---
  // Logged in: saved as that user, with their email. Otherwise (login page, the demo):
  // saved without a user, with an email only if they typed one, and rate limited.
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    return readJson(req, res, 20_000, async (input) => {
      if (!loggedIn && feedbackLimited(req)) {
        return sendJson(res, { error: "Thanks for all the feedback! Wait a few minutes before sending more." }, 429);
      }
      let email = req.user ? req.user.email : (typeof input.email === "string" ? input.email.trim() : "");
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
    });
  }

  // ----- API: the dashboard's JavaScript talks to these -----
  if (url.pathname.startsWith("/api/")) {
    if (inDemo) return demo.handleApi(req, res, url, { sendJson, readJson });
    if (!loggedIn) return sendJson(res, { error: "Not logged in" }, 401);

    // Every query below runs as the logged-in user, so they only see their own data
    const db = auth.supabaseFor(req);
    const userId = auth.getUserId(req);

    // --- Account settings (auth.js): each needs the current password ---
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

    if (req.method === "POST" && url.pathname === "/api/account/password") {
      return readJson(req, res, 10_000, async (input) => {
        const result = await auth.changePassword(req, input.currentPassword, input.newPassword);
        if (result.error) return sendJson(res, accountError(result.error), 400);
        res.setHeader("Set-Cookie", result.cookies);
        sendJson(res, { ok: true });
      });
    }

    if (req.method === "POST" && url.pathname === "/api/account/email") {
      return readJson(req, res, 10_000, async (input) => {
        const result = await auth.changeEmail(req, input.password, input.email);
        if (result.error) return sendJson(res, accountError(result.error), 400);
        sendJson(res, result);
      });
    }

    if (req.method === "POST" && url.pathname === "/api/account/delete") {
      return readJson(req, res, 10_000, async (input) => {
        if (input.confirm !== "DELETE") return sendJson(res, { error: "Type DELETE to confirm." }, 400);
        const result = await auth.deleteAccount(req, input.password, async () => {
          // PDFs live in Storage, which doesn't clean up by itself: remove them first
          for (const source of await materials.listSources(db)) await materials.removeSource(db, source.id);
        });
        if (result.error) return sendJson(res, accountError(result.error), 400);
        res.setHeader("Set-Cookie", result.cookies);
        sendJson(res, { ok: true });
      });
    }

    // --- Who's logged in (for "Logged in as ..." on the dashboard) ---
    if (req.method === "GET" && url.pathname === "/api/me") {
      const profile = await onboarding.getProfile(db, userId);
      return sendJson(res, { email: req.user.email, name: onboarding.displayName(profile, req.user) });
    }

    // --- First-login setup and study preference (onboarding.js) ---
    // aiScheduling: whether study times are planned by the AI (needs an AI key, see ai.js)
    if (req.method === "GET" && url.pathname === "/api/profile") {
      const profile = await onboarding.getProfile(db, userId);
      return sendJson(res, { ...profile, displayName: onboarding.displayName(profile, req.user), aiScheduling: ai.aiEnabled() });
    }

    // --- Weekly study plan (studyplan.js) ---
    if (req.method === "GET" && url.pathname === "/api/study-plan") {
      const [calendar, profile] = await Promise.all([schedule.loadClasses(db), onboarding.getProfile(db, userId)]);
      return sendJson(res, await studyplan.getStudyPlan(db, userId, calendar, profile));
    }

    // --- "I studied" checkmarks on solo study sessions (studylog.js) ---
    if (req.method === "GET" && url.pathname === "/api/study-log") {
      const result = await studylog.listDone(db, url.searchParams.get("from"), url.searchParams.get("to"));
      if (result.error) return sendJson(res, { error: result.error }, 400);
      return sendJson(res, result.value);
    }
    if (req.method === "POST" && url.pathname === "/api/study-log") {
      return readJson(req, res, 2_000, async (input) => {
        const result = await studylog.setDone(db, userId, input);
        if (result.error) return sendJson(res, { error: result.error }, result.status || 400);
        sendJson(res, result.value);
      });
    }

    if (req.method === "POST" && url.pathname === "/api/profile") {
      return readJson(req, res, 10_000, async (input) => {
        let result;
        try {
          result = await onboarding.updateProfile(db, userId, input);
        } catch (error) {
          if (error.code !== "SESSION_LENGTH_COLUMN") throw error;
          console.error(error.message);
          return sendJson(res, { error: "Session length can't be saved yet. Try again later." }, 503);
        }
        if (result.error) return sendJson(res, { error: result.error }, 400);
        await groups.matchQuietly(db); // wants a group now → find one; prefers alone → leave theirs
        sendJson(res, result.value);
      });
    }

    // --- Study times for the dashboard calendar ---
    // In a study group → its weekly meeting. Otherwise (alone, or still waiting for a
    // group) → the weekly study plan, same as the landing page shows.
    if (req.method === "GET" && url.pathname === "/api/study-times") {
      const [calendar, profile, myGroups] = await Promise.all([
        schedule.loadClasses(db),
        onboarding.getProfile(db, userId),
        groups.listMyGroups(db, userId),
      ]);
      if (profile.preference === "group" && myGroups.length) {
        return sendJson(res, myGroups.map((g) => ({
          type: "group",
          id: g.id,
          name: g.name,
          days: g.days,
          start: g.start,
          end: g.end,
          note: g.members.length + (g.members.length === 1 ? " member" : " members"),
        })));
      }
      const plan = await studyplan.getStudyPlan(db, userId, calendar, profile);
      return sendJson(res, plan.sessions.map((s) => ({
        type: "study",
        name: "Study time",
        days: [s.day],
        start: s.start,
        end: s.end,
        note: s.reason || s.label,
      })));
    }

    // --- Study groups (groups.js): matched automatically, students never pick one ---
    // Opening the landing page tries to match the student, then shows their group
    if (req.method === "POST" && url.pathname === "/api/groups/match") {
      await groups.match(db);
      return sendJson(res, await groups.listMyGroups(db, userId));
    }

    // Each of your classes and whether you're in a group for it yet (landing page "still looking")
    if (req.method === "GET" && url.pathname === "/api/groups/classes") {
      return sendJson(res, await groups.listClassGroups(db));
    }

    // --- Course catalog (courses.js): the class picker's suggestions ---
    if (req.method === "GET" && url.pathname === "/api/courses") {
      if (url.searchParams.has("subject")) return sendJson(res, courses.coursesInSubject(url.searchParams.get("subject")));
      return sendJson(res, await courses.searchCourses(db, url.searchParams.get("q")));
    }
    // Every subject A-Z, for browsing (MATH → its classes)
    if (req.method === "GET" && url.pathname === "/api/courses/subjects") {
      return sendJson(res, courses.listSubjects());
    }

    // Sections of one course this term, from Sac State's class schedule (sections.js)
    if (req.method === "GET" && url.pathname === "/api/courses/sections") {
      const code = courses.normalizeCourse(url.searchParams.get("code"));
      try {
        return sendJson(res, await sections.getSections(code));
      } catch (error) {
        console.error("Class schedule lookup failed:", error.message || error);
        return sendJson(res, { error: "Couldn't reach Sac State's class schedule. Enter the days and times yourself." }, 502);
      }
    }

    const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

    // Meeting up (meetups.js): the spot and suggestions, RSVPs, moving a week's session, session chat.
    // Every change answers with the fresh { meetup, spots, rsvps, moves } so the page just redraws.
    const meetupMatch = url.pathname.match(new RegExp(`^/api/groups/(${UUID})/(meetup|spots|rsvp|slots|move|messages)(?:/(${UUID})(/vote)?)?$`));
    if (meetupMatch) {
      const [, groupId, part, spotId, isVote] = meetupMatch;
      const group = await groups.getGroup(db, groupId, userId);
      if (!group) return sendJson(res, { error: "That group doesn't exist, or you're not in it." }, 404);

      const reply = async (result, status = 200) => {
        if (result && result.error) return sendJson(res, { error: result.error }, 400);
        const info = await meetups.getInfo(db, group, userId);
        sendJson(res, { ...info, ...(result && typeof result.value === "object" ? result.value : {}) }, status);
      };
      const run = (work) => work().catch((error) => {
        if (!meetups.isMissingTable(error)) throw error;
        console.error("Meetups need the latest supabase/schema.sql:", error.message || error);
        sendJson(res, { error: "Meetups aren't set up yet. Run the latest supabase/schema.sql in Supabase.", notSetUp: true }, 503);
      });
      const body = (limit, work) => readJson(req, res, limit, (input) => run(() => work(input)));

      if (req.method !== "GET" && !writeAllowed(userId)) {
        return sendJson(res, { error: "That's a lot of changes at once. Wait a few seconds and try again." }, 429);
      }
      if (req.method === "GET" && part === "meetup") return run(() => reply(null));
      if (req.method === "POST" && part === "meetup") return body(2_000, async (input) => reply(await meetups.setMeetup(db, group, userId, input)));
      if (req.method === "DELETE" && part === "meetup") return run(async () => { await meetups.clearMeetup(db, group); await reply(null); });
      if (req.method === "POST" && part === "spots" && !spotId) return body(2_000, async (input) => reply(await meetups.addSpot(db, group, userId, input), 201));
      if (req.method === "POST" && part === "spots" && spotId && isVote) {
        return body(1_000, async (input) => reply(await meetups.setVote(db, group, userId, spotId, input.on !== false)));
      }
      if (req.method === "DELETE" && part === "spots" && spotId && !isVote) return run(async () => { await meetups.removeSpot(db, group, spotId); await reply(null); });
      if (req.method === "POST" && part === "rsvp") return body(1_000, async (input) => reply(await meetups.setRsvp(db, group, userId, input)));
      if (req.method === "GET" && part === "slots") return run(async () => sendJson(res, await meetups.freeSlots(db, group)));
      if (req.method === "POST" && part === "move") return body(1_000, async (input) => reply(await meetups.moveSession(db, group, input)));
      if (req.method === "DELETE" && part === "move") {
        return run(async () => reply(await meetups.undoMove(db, group, { sessionDate: url.searchParams.get("session") })));
      }

      // Session chat: these answer with messages, not the whole meetup info
      const answer = (result, status = 200) =>
        result.error ? sendJson(res, { error: result.error }, 400) : sendJson(res, result.value, status);
      if (req.method === "GET" && part === "messages" && !spotId) {
        return run(async () => answer(await meetups.listMessages(db, group, userId, url.searchParams.get("session"), url.searchParams.get("after"))));
      }
      if (req.method === "POST" && part === "messages" && !spotId) {
        const profile = await onboarding.getProfile(db, userId);
        if (!onboarding.displayName(profile, req.user)) {
          return sendJson(res, { error: "Add your name in Account settings first, so your group knows who's talking.", needsName: true }, 400);
        }
        return body(5_000, async (input) => answer(await meetups.addMessage(db, group, userId, input), 201));
      }
      if (req.method === "DELETE" && part === "messages" && spotId) {
        return run(async () => { await meetups.removeMessage(db, group, spotId); sendJson(res, { ok: true }); });
      }
      return sendJson(res, { error: "Not found" }, 404);
    }

    // One group + its shared notes (only members can see it)
    const groupMatch = url.pathname.match(new RegExp(`^/api/groups/(${UUID})(?:/notes(?:/(${UUID}))?|/(discord))?$`));
    if (groupMatch) {
      const [, groupId, noteId, isDiscord] = groupMatch;
      const isNotes = url.pathname.includes("/notes");
      const group = await groups.getGroup(db, groupId, userId);
      if (!group) return sendJson(res, { error: "That group doesn't exist, or you're not in it." }, 404);

      // The class's Discord server (shared by every group in the class): anyone in it can set,
      // change or remove the invite link
      // (Paused for now: groups.DISCORD_ENABLED)
      if (req.method === "PUT" && isDiscord && groups.DISCORD_ENABLED) {
        return readJson(req, res, 2_000, async (input) => {
          const result = await groups.setDiscord(db, group, input);
          if (result.error) return sendJson(res, { error: result.error }, 400);
          sendJson(res, result.value);
        });
      }

      if (req.method === "GET" && !isNotes && !isDiscord) {
        // A missing Discord table (schema.sql not re-run yet) shouldn't break the group page
        const classDiscord = !groups.DISCORD_ENABLED ? null : groups.getClassDiscordLink(db, group)
          .then((link) => groups.discordForBrowser(link))
          .catch((error) => { console.error("Class Discord lookup failed (run supabase/schema.sql again?):", error.message || error); return null; });
        const [notes, discord] = await Promise.all([groups.listNotes(db, group, userId), classDiscord]);
        const { members, ...details } = group;
        return sendJson(res, {
          group: { ...details, discord, discordEnabled: groups.DISCORD_ENABLED, members: members.map(groups.memberForBrowser) },
          notes,
        });
      }
      if (req.method === "POST" && isNotes && !noteId) {
        return readJson(req, res, 50_000, async (input) => {
          const result = await groups.addNote(db, group, userId, input);
          if (result.error) return sendJson(res, { error: result.error }, 400);
          sendJson(res, result.value, 201);
        });
      }
      if (req.method === "DELETE" && noteId) {
        await groups.removeNote(db, groupId, noteId);
        return sendJson(res, { ok: true });
      }
    }

    // --- Class schedule ---
    if (req.method === "GET" && url.pathname === "/api/classes") {
      return sendJson(res, await schedule.loadClasses(db));
    }

    if (req.method === "POST" && url.pathname === "/api/classes") {
      return readJson(req, res, 10_000, async (input) => {
        const result = await schedule.addClass(db, input);
        if (result.error) return sendJson(res, { error: result.error }, 400);
        await groups.matchQuietly(db); // a new class might clash with their study group
        // extra: more time blocks of the same section (e.g. MWF 10:00 + Tue 10:30), already saved
        sendJson(res, { ...result.value, extra: result.extra || [] }, 201);
      });
    }

    const classMatch = url.pathname.match(/^\/api\/classes\/([\w-]+)$/);
    if (req.method === "PUT" && classMatch) {
      return readJson(req, res, 10_000, async (input) => {
        const result = await schedule.updateClass(db, classMatch[1], input);
        if (result.notFound) return sendJson(res, { error: "That item was already removed. Refresh the page." }, 404);
        if (result.error) return sendJson(res, { error: result.error }, 400);
        await groups.matchQuietly(db); // the new time might clash with their study group
        sendJson(res, result.value);
      });
    }

    if (req.method === "DELETE" && classMatch) {
      await schedule.removeClass(db, classMatch[1]);
      await groups.matchQuietly(db); // more free time might mean a group fits now
      return sendJson(res, { ok: true });
    }

    // --- Virtual Notebook: course materials ---
    if (req.method === "GET" && url.pathname === "/api/sources") {
      return sendJson(res, (await materials.listSources(db)).map(materials.forBrowser));
    }

    if (req.method === "POST" && url.pathname === "/api/sources") {
      return readJson(req, res, 7_500_000, async (input) => { // room for a 5 MB PDF (base64 is a third bigger)
        const result = await materials.addSource(db, userId, input);
        if (result.error) return sendJson(res, { error: result.error }, 400);
        sendJson(res, result.value, 201);
      });
    }

    const sourceMatch = url.pathname.match(/^\/api\/sources\/([\w-]+)$/);

    // Viewing a material: its details, plus the text for typed or pasted notes
    if (req.method === "GET" && sourceMatch) {
      const source = await materials.getSource(db, sourceMatch[1]);
      if (!source) return sendJson(res, { error: "That material was removed. Refresh the page." }, 404);
      const text = source.type === "text" ? await materials.readContent(db, source) : null;
      return sendJson(res, { ...materials.forBrowser(source), text });
    }

    // The PDF itself, shown in the browser's PDF viewer
    const sourceFileMatch = url.pathname.match(/^\/api\/sources\/([\w-]+)\/file$/);
    if (req.method === "GET" && sourceFileMatch) {
      const source = await materials.getSource(db, sourceFileMatch[1]);
      if (!source || source.type !== "pdf") return sendJson(res, { error: "PDF not found" }, 404);
      const pdf = await materials.readPdf(db, source);
      const filename = source.title.replace(/[^\w .()-]+/g, "").trim() || "material";
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.length,
        "Content-Disposition": `inline; filename="${filename}.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      });
      return res.end(pdf);
    }

    if (req.method === "DELETE" && sourceMatch) {
      await materials.removeSource(db, sourceMatch[1]);
      return sendJson(res, { ok: true });
    }

    // --- Virtual Notebook: saved chats ---
    if (req.method === "GET" && url.pathname === "/api/chats") {
      return sendJson(res, await chats.listChats(db));
    }

    const chatMatch = url.pathname.match(/^\/api\/chats\/([\w-]+)$/);
    if (req.method === "GET" && chatMatch) {
      const chat = await chats.getChat(db, chatMatch[1]);
      return chat ? sendJson(res, chat) : sendJson(res, { error: "Chat not found" }, 404);
    }
    if (req.method === "DELETE" && chatMatch) {
      await chats.deleteChat(db, chatMatch[1]);
      return sendJson(res, { ok: true });
    }

    // --- Virtual Notebook: asking the AI ---
    if (req.method === "GET" && url.pathname === "/api/notebook/status") {
      return sendJson(res, { aiEnabled: ai.aiEnabled(), freeTier: ai.aiEnabled() && ai.providerInfo().freeTier });
    }

    if (req.method === "POST" && url.pathname === "/api/notebook/ask") {
      return readJson(req, res, 2_000_000, async (input) => {
        if (!ai.aiEnabled()) return sendJson(res, { error: `AI answers are off. Add ${ai.providerInfo().keyName} to .env and restart the server.` }, 503);

        const question = typeof input.question === "string" ? input.question.trim() : "";
        const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 200) : question;
        const ids = Array.isArray(input.sourceIds) ? input.sourceIds : [];
        if (!question || question.length > 5_000) return sendJson(res, { error: "Type a question (5,000 characters max)." }, 400);

        // Continue an existing chat, or start a new one when there's no chatId
        const isChatId = typeof input.chatId === "string" && /^[\w-]+$/.test(input.chatId);
        const chat = isChatId ? await chats.getChat(db, input.chatId) : null;
        if (input.chatId && !chat) return sendJson(res, { error: "That chat was deleted. Start a new chat." }, 404);
        const history = chat ? chats.historyFor(chat) : [];

        const selected = (await materials.listSources(db)).filter((s) => ids.includes(s.id));
        if (selected.length === 0) return sendJson(res, { error: "Tick at least one source to ask about." }, 400);

        const sources = await Promise.all(selected.map(async (source) => ({ source: materials.forBrowser(source), content: await materials.readContent(db, source) })));
        const totalSize = sources.reduce((sum, s) => sum + s.content.length, 0);
        if (totalSize > 25_000_000) return sendJson(res, { error: "That's too much material at once. Untick a few sources." }, 400);

        let result;
        try {
          result = await ai.askNotebook({ sources, history, question });
        } catch (error) {
          console.error("Notebook question failed:", error);
          return sendJson(res, { error: ai.explainError(error) }, 502);
        }
        if (result.error) return sendJson(res, { error: result.error }, 422);
        const saved = await chats.addExchange(db, chat, { label, question, ...result });
        sendJson(res, { ...result, chat: chats.summary(saved) });
      });
    }

    // --- Canvas: link an account and load homework (canvas.js) ---
    if (url.pathname === "/api/canvas/connect" && req.method === "POST") {
      return readJson(req, res, 10_000, async (input) => {
        const result = await canvas.connect(db, userId, input);
        if (result.error) return sendJson(res, { error: result.error }, result.status);
        sendJson(res, result.value, 201);
      });
    }

    if (url.pathname === "/api/canvas/connect" && req.method === "DELETE") {
      await canvas.disconnect(db, userId);
      return sendJson(res, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/canvas/status") {
      return sendJson(res, await canvas.status(db));
    }

    // Calendar Feed only: tick an assignment off as done (body { id, done: true/false })
    if (req.method === "POST" && url.pathname === "/api/canvas/done") {
      return readJson(req, res, 2_000, async (input) => {
        const result = await canvas.setDone(db, userId, input);
        if (result.error) return sendJson(res, { error: result.error }, result.status);
        sendJson(res, result.value);
      });
    }

    if (req.method === "GET" && url.pathname === "/api/canvas/assignments") {
      const result = await canvas.getAssignments(db);
      if (result.error) return sendJson(res, { error: result.error, reconnect: Boolean(result.reconnect) }, result.status);
      return sendJson(res, result.value);
    }

    return sendJson(res, { error: "Not found" }, 404);
  }

  sendPage(res, "404.html", 404);
}

// ---------- Start the server ----------
server.listen(PORT, () => {
  console.log(`StudySync is running at ${(process.env.PUBLIC_URL || "").trim() || "http://localhost:" + PORT}`);
  if (!auth.isConfigured()) console.log("Login: put the real SUPABASE_URL and SUPABASE_KEY in .env (not the example values), then restart.");
  const aiInfo = ai.providerInfo();
  if (ai.providerProblem()) console.log("AI: " + ai.providerProblem());
  else console.log(ai.aiEnabled()
    ? `AI: using ${aiInfo.name} for notebook answers and study plans.`
    : `Virtual Notebook: AI answers are off (no ${aiInfo.keyName} in .env).`);
});
