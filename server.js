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
//   groups.js     → study groups (students are matched automatically by schedule)
//   studyplan.js  → weekly study times: picked by the AI if there's a key, else by public/planner.js
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
const studyplan = require("./studyplan");

const PORT = 3000;

// ---------- Helpers for sending responses ----------

// Send one of the HTML files from the pages/ folder
function sendPage(res, fileName, status = 200) {
  const html = fs.readFileSync(path.join(__dirname, "pages", fileName), "utf8");
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
      redirect(res, "/home", { "Set-Cookie": result.cookies });
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
      const result = await auth.signUp((form.get("email") || "").trim(), form.get("password") || "");
      if (result.error) return redirect(res, `/signup?error=${result.error}`);
      if (result.confirmEmail) return redirect(res, "/?checkEmail=1");
      redirect(res, "/home", { "Set-Cookie": result.cookies });
    });
  }

  // Loading screen, then the dashboard (logged-in users only)
  if (req.method === "GET" && url.pathname === "/home") {
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "loading.html");
  }

  // After the loading screen: first login → the schedule screen, otherwise → the dashboard.
  // (Finishing the schedule screen shows the landing page once: study plan + groups.)
  if (req.method === "GET" && url.pathname === "/start") {
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
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "setup.html");
  }

  if (req.method === "GET" && url.pathname === "/landing") {
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "landing.html");
  }

  if (req.method === "GET" && url.pathname === "/dashboard") {
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "dashboard.html");
  }

  // One study group's page: /group?id=<group id>
  if (req.method === "GET" && url.pathname === "/group") {
    if (!loggedIn) return redirect(res, "/");
    return sendPage(res, "group.html");
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
      const result = await auth.sendPasswordReset(email, `http://${req.headers.host}/reset-password`);
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

  if (req.method === "GET" && url.pathname === "/logout") {
    return redirect(res, "/", { "Set-Cookie": await auth.logOut(req) });
  }

  // ----- API: the dashboard's JavaScript talks to these -----
  if (url.pathname.startsWith("/api/")) {
    if (!loggedIn) return sendJson(res, { error: "Not logged in" }, 401);

    // Every query below runs as the logged-in user, so they only see their own data
    const db = auth.supabaseFor(req);
    const userId = auth.getUserId(req);

    // --- Who's logged in (for "Logged in as ..." on the dashboard) ---
    if (req.method === "GET" && url.pathname === "/api/me") {
      return sendJson(res, { email: req.user.email });
    }

    // --- First-login setup and study preference (onboarding.js) ---
    // aiScheduling: whether study times are planned by the AI (needs an AI key, see ai.js)
    if (req.method === "GET" && url.pathname === "/api/profile") {
      return sendJson(res, { ...(await onboarding.getProfile(db, userId)), aiScheduling: ai.aiEnabled() });
    }

    // --- Weekly study plan (studyplan.js) ---
    if (req.method === "GET" && url.pathname === "/api/study-plan") {
      const [calendar, profile] = await Promise.all([schedule.loadClasses(db), onboarding.getProfile(db, userId)]);
      return sendJson(res, await studyplan.getStudyPlan(db, userId, calendar, profile));
    }

    if (req.method === "POST" && url.pathname === "/api/profile") {
      return readJson(req, res, 10_000, async (input) => {
        const result = await onboarding.updateProfile(db, userId, input);
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

    // One group + its shared notes (only members can see it)
    const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    const groupMatch = url.pathname.match(new RegExp(`^/api/groups/(${UUID})(?:/notes(?:/(${UUID}))?)?$`));
    if (groupMatch) {
      const [, groupId, noteId] = groupMatch;
      const isNotes = url.pathname.includes("/notes");
      const group = await groups.getGroup(db, groupId, userId);
      if (!group) return sendJson(res, { error: "That group doesn't exist, or you're not in it." }, 404);

      if (req.method === "GET" && !isNotes) {
        const notes = await groups.listNotes(db, group, userId);
        const { members, ...details } = group;
        return sendJson(res, {
          group: { ...details, members: members.map(groups.memberForBrowser) },
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

    // --- Feedback / bug reports ---
    if (req.method === "POST" && url.pathname === "/api/feedback") {
      return readJson(req, res, 20_000, async (input) => {
        const result = await feedback.addFeedback(db, input, req.headers["user-agent"], req.user.email);
        if (result.error) return sendJson(res, { error: result.error }, 400);
        sendJson(res, { ok: true }, 201);
      });
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
        sendJson(res, result.value, 201);
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
      return readJson(req, res, 15_000_000, async (input) => { // room for a 10 MB PDF
        const result = await materials.addSource(db, userId, input);
        if (result.error) return sendJson(res, { error: result.error }, 400);
        sendJson(res, result.value, 201);
      });
    }

    const sourceMatch = url.pathname.match(/^\/api\/sources\/([\w-]+)$/);
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
  console.log(`StudySync is running at http://localhost:${PORT}`);
  if (!auth.isConfigured()) console.log("Login: put the real SUPABASE_URL and SUPABASE_KEY in .env (not the example values), then restart.");
  const aiInfo = ai.providerInfo();
  if (ai.providerProblem()) console.log("AI: " + ai.providerProblem());
  else console.log(ai.aiEnabled()
    ? `AI: using ${aiInfo.name} for notebook answers and study plans.`
    : `Virtual Notebook: AI answers are off (no ${aiInfo.keyName} in .env).`);
});
