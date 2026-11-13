// StudySync - the server: starts it up and sends each request to its route.
// Run with:  node --watch server.js   (or press F5 in VS Code)
// Then open: http://localhost:3000
//
// Where everything lives:
//   server.js   → this file: starts the server, works out who's asking, picks the route
//   routes/     → which URL does what, one file per part of the app:
//     pages.js     the pages, login / sign-up / password forms, the demo, feedback
//     account.js   account settings, who's logged in
//     study.js     profile, weekly study plan and its quick edits, "I studied" checkmarks
//     schedule.js  calendar items, course catalog and sections
//     groups.js    study groups, meetups, session chat
//     notebook.js  the study assistant: materials, saved chats, asking the AI
//     canvas.js    linking Canvas and loading homework
//     calendar.js  "Add to my calendar": the private calendar link and its feed
//   lib/        → the work behind the routes (Supabase, the AI, Canvas, the demo...):
//     http.js        sending pages / JSON, reading requests, the router
//     auth.js        login with Supabase and who's logged in
//     onboarding.js  profile: name, "study alone or in a group?", weekly study goal
//     schedule.js    calendar items          courses.js / sections.js  Sac State's catalog and class schedule
//     groups.js      study groups (matched by schedule, one per class)   meetups.js  meeting up
//     studyplan.js   weekly study times (AI if there's a key, else public/planner.js)   studylog.js  checkmarks
//     materials.js / chats.js  notebook materials and chats   ai.js  the AI (ai-gemini.js / ai-anthropic.js)
//     canvas.js      Canvas homework         feedback.js  feedback reports    limits.js  rate limits
//     terms.js       this semester's dates and holidays   calendarfeed.js  the .ics calendar feed
//     demo.js        "Try the demo": the real pages with sample data, no account needed
//   pages/      → the HTML for each page
//   public/     → CSS and browser JavaScript the pages load
//   .env        → your secret keys: Supabase, Gemini or Anthropic (never commit this!)

const http = require("http");
const path = require("path");

// Load secrets (SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY) from .env, if that file exists
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // no .env yet → nobody can log in until the Supabase keys are added
}

const auth = require("./lib/auth");
const ai = require("./lib/ai");
const demo = require("./lib/demo");
const { sendPage, sendJson, readJson, sendPublicFile, handleError, compile, route } = require("./lib/http");

// Hosts like Render choose the port and pass it in PORT; on your computer it's 3000
const PORT = Number(process.env.PORT) || 3000;

// Routes anyone can use (pages, login forms, the demo, feedback)
const calendar = require("./routes/calendar");
const publicRoutes = compile([...require("./routes/pages"), ...calendar.feedRoutes]);

// /api/ routes for logged-in students (demo visitors are answered by lib/demo.js instead)
const apiRoutes = compile([
  ...require("./routes/account"),
  ...require("./routes/study"),
  ...require("./routes/schedule"),
  ...require("./routes/groups"),
  ...require("./routes/notebook"),
  ...require("./routes/canvas"),
  ...calendar.apiRoutes,
]);

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => handleError(res, error));
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CSS, browser JavaScript and images (no login check needed)
  if (req.method === "GET" && url.pathname.startsWith("/public/")) {
    return sendPublicFile(res, url.pathname);
  }

  // Who's logged in? After this, auth.getUserId(req) gives their Supabase user ID
  await auth.loadUser(req, res);
  const loggedIn = auth.isLoggedIn(req);
  // Trying the demo (lib/demo.js): no account, sample data. A real login always wins.
  const inDemo = !loggedIn && demo.hasDemo(req);
  // The welcome page's live demo box: the demo without its banner. It starts at ?embed=1;
  // pages visitors click to inside the box stay embedded (browsers mark frame loads with
  // Sec-Fetch-Dest: iframe), so the banner never shows up inside it.
  const inFrame = url.searchParams.get("embed") === "1" || req.headers["sec-fetch-dest"] === "iframe";
  const demoMode = inDemo && inFrame ? "embed" : inDemo;
  // Logging in, signing up or logging out also ends the demo
  const endDemo = (cookies) => (demo.hasDemo(req) ? [...[].concat(cookies), demo.clearCookie()] : cookies);

  const ctx = { req, res, url, loggedIn, inDemo, demoMode, endDemo };
  if (await route(publicRoutes, ctx)) return;

  if (url.pathname.startsWith("/api/")) {
    if (inDemo) return demo.handleApi(req, res, url, { sendJson, readJson });
    if (!loggedIn) return sendJson(res, { error: "Not logged in" }, 401);
    // Every query runs as the logged-in student, so they only see their own data
    ctx.db = auth.supabaseFor(req);
    ctx.userId = auth.getUserId(req);
    if (await route(apiRoutes, ctx)) return;
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
