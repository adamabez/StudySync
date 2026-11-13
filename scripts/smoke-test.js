// StudySync - smoke test: starts the server and checks that every page and API route
// still answers the same way. It uses the demo (sample data, no Supabase writes), so it's
// safe to run anywhere.
//
//   npm test                  → compare against test/baseline.json
//   npm test -- --save        → record a new baseline (after a change you meant to make)
//
// What's compared for each request: the status code, where a redirect goes, and the
// "shape" of the JSON (keys and value types, not the values: ids and dates change every run).

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASELINE = path.join(ROOT, "test", "baseline.json");
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const SAVE = process.argv.includes("--save");

// Keys and types only, so random ids / today's dates don't count as changes
function shape(value) {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = shape(value[key]);
    return out;
  }
  return value === null ? "null" : typeof value;
}

async function call(method, urlPath, { cookie, body, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: payload, redirect: "manual" });
  const type = res.headers.get("content-type") || "";
  const result = { status: res.status };
  if (res.headers.get("location")) result.location = res.headers.get("location").replace(/\?.*$/, "");
  const text = await res.text();
  if (type.includes("application/json")) {
    result.json = JSON.parse(text);
    result.shape = shape(result.json);
  } else if (type.includes("text/html")) {
    result.title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  } else {
    result.type = type.split(";")[0];
  }
  return { ...result, setCookie: res.headers.getSetCookie() };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + "/ai-status");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("The server didn't start on port " + PORT);
}

async function run() {
  const results = {};
  const record = async (name, method, urlPath, options) => {
    const r = await call(method, urlPath, options);
    const { json, setCookie, ...kept } = r;
    results[name] = kept;
    return r;
  };

  // --- Logged out: pages and redirects ---
  for (const page of ["/", "/signup", "/forgot", "/reset-password", "/home", "/start", "/setup", "/landing",
    "/dashboard", "/account", "/group", "/nope", "/public/style.css", "/public/planner.js", "/public/logo.png",
    "/public/../server.js", "/public/missing.js"]) {
    await record("out GET " + page, "GET", page);
  }
  await record("out GET /ai-status", "GET", "/ai-status");
  await record("out GET /api/me", "GET", "/api/me");
  await record("out POST /api/feedback bad email", "POST", "/api/feedback", { body: { message: "hi", email: "nope" } });
  await record("out POST /api/feedback bad json", "POST", "/api/feedback", { body: undefined });
  await record("out POST /reset-password weak", "POST", "/reset-password", { body: { password: "123" } });

  // --- Start a demo ---
  const started = await record("GET /demo", "GET", "/demo");
  const cookie = started.setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("/demo didn't set a cookie");
  await record("demo GET /demo again", "GET", "/demo", { cookie });
  await record("demo GET /demo embed", "GET", "/demo?embed=1&to=dashboard");
  const opts = { cookie };

  for (const page of ["/", "/home", "/start", "/setup", "/landing", "/dashboard", "/account", "/group",
    "/landing?embed=1", "/dashboard?embed=1"]) {
    await record("demo GET " + page, "GET", page, opts);
  }

  // --- Demo API: reads ---
  for (const api of ["/api/me", "/api/profile", "/api/study-plan", "/api/study-times", "/api/groups/classes",
    "/api/classes", "/api/sources", "/api/chats", "/api/notebook/status", "/api/canvas/status",
    "/api/canvas/assignments", "/api/courses?q=math", "/api/courses?subject=MATH", "/api/courses/subjects",
    "/api/study-log?from=2026-01-01&to=2026-12-31", "/api/nope"]) {
    await record("demo GET " + api, "GET", api, opts);
  }

  const groups = (await record("demo POST /api/groups/match", "POST", "/api/groups/match", opts)).json;
  const group = Array.isArray(groups) && groups[0];
  if (group) {
    const g = "/api/groups/" + group.id;
    await record("demo GET group", "GET", g, opts);
    await record("demo GET group meetup", "GET", g + "/meetup", opts);
    await record("demo GET group slots", "GET", g + "/slots", opts);
    await record("demo GET group messages", "GET", g + "/messages", opts);
    await record("demo POST group note", "POST", g + "/notes", { cookie, body: { text: "Smoke test note" } });
    await record("demo POST group note empty", "POST", g + "/notes", { cookie, body: { text: "" } });
    await record("demo POST group spot", "POST", g + "/spots", { cookie, body: { name: "Library 2nd floor" } });
    await record("demo POST group rsvp", "POST", g + "/rsvp", { cookie, body: { going: true } });
  }
  await record("demo GET missing group", "GET", "/api/groups/00000000-0000-0000-0000-000000000000", opts);

  // --- Demo API: writes ---
  const added = await record("demo POST class", "POST", "/api/classes", {
    cookie, body: { name: "SMOKE 101", type: "class", days: ["mon", "wed"], start: "08:00", end: "09:15" },
  });
  await record("demo POST class bad", "POST", "/api/classes", { cookie, body: { name: "", days: [] } });
  if (added.json && added.json.id) {
    await record("demo PUT class", "PUT", "/api/classes/" + added.json.id, {
      cookie, body: { name: "SMOKE 102", type: "class", days: ["tue"], start: "10:00", end: "11:00" },
    });
    await record("demo DELETE class", "DELETE", "/api/classes/" + added.json.id, opts);
  }
  await record("demo POST profile", "POST", "/api/profile", { cookie, body: { weeklyHours: 6 } });
  await record("demo POST profile bad", "POST", "/api/profile", { cookie, body: { weeklyHours: 99 } });
  await record("demo POST source", "POST", "/api/sources", { cookie, body: { type: "text", title: "Smoke", text: "Some notes" } });
  await record("demo POST account", "POST", "/api/account/password", { cookie, body: {} });
  // An empty message is refused before anything is saved (a real one would land in Supabase)
  await record("demo POST feedback empty", "POST", "/api/feedback", { cookie, body: { message: "", page: "/dashboard" } });

  // --- Ending the demo ---
  await record("demo GET /logout", "GET", "/logout", opts);
  return results;
}

function compare(before, after) {
  const problems = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = JSON.stringify(before[name]);
    const b = JSON.stringify(after[name]);
    if (a !== b) problems.push(`  ${name}\n    was: ${a}\n    now: ${b}`);
  }
  return problems;
}

async function main() {
  // A blank AI key keeps the demo from calling Gemini; feedback can't reach Supabase either way
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  try {
    await waitForServer();
    const results = await run();
    if (SAVE || !fs.existsSync(BASELINE)) {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(results, null, 2) + "\n");
      console.log(`Saved ${Object.keys(results).length} checks to test/baseline.json`);
      return;
    }
    const problems = compare(JSON.parse(fs.readFileSync(BASELINE, "utf8")), results);
    if (problems.length) {
      console.error(`${problems.length} check(s) changed:\n` + problems.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(`All ${Object.keys(results).length} checks match test/baseline.json`);
    }
  } catch (error) {
    console.error(error);
    console.error("Server output:\n" + log);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

main();
