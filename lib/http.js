// StudySync - helpers for answering requests: pages, JSON, redirects, files, reading what
// the browser sent, and a small router (a list of [method, path, handler] routes).

const fs = require("fs");
const path = require("path");
const demo = require("./demo");

const ROOT = path.join(__dirname, "..");

// The site's public address, for links in emails (password reset). Set PUBLIC_URL in .env
// (or the host's settings) when it's online, e.g. https://studysync.onrender.com. Otherwise
// it's worked out from the request (http://localhost:3000 on your computer).
function siteUrl(req) {
  const fromEnv = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${req.headers.host}`;
}

// ---------- Sending responses ----------

// Send one of the HTML files from the pages/ folder
// (inDemo adds the "You're trying a demo" banner; "embed" is the login page's live preview)
function sendPage(res, fileName, status = 200, inDemo = false) {
  let html = fs.readFileSync(path.join(ROOT, "pages", fileName), "utf8");
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

// Send a CSS, JS or image file from the public/ folder (e.g. /public/style.css)
const FILE_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", // what makes the site installable as an app
};

function sendPublicFile(res, urlPath) {
  const fileName = path.basename(urlPath); // basename blocks tricks like /public/../server.js
  const type = FILE_TYPES[path.extname(fileName)];
  const filePath = path.join(ROOT, "public", fileName);
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

// ---------- Reading what the browser sent ----------

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

// Many handlers answer a { value } / { error, status } result the same way
function sendResult(res, result, status = 200) {
  if (result.error) return sendJson(res, { error: result.error }, result.status || 400);
  sendJson(res, result.value, status);
}

// ---------- Router ----------
// A route is [method, path, handler]. In paths, ":name" matches one part of the URL
// (letters, digits, - and _) and ":name(uuid)" only a UUID; they end up in ctx.params.

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

function compile(routes) {
  return routes.map(([method, pattern, handler]) => {
    const names = [];
    const source = pattern.replace(/[.]/g, "\\.").replace(/:(\w+)(\(uuid\))?/g, (_, name, uuid) => {
      names.push(name);
      return uuid ? `(${UUID})` : "([\\w-]+)";
    });
    return { method, regex: new RegExp(`^${source}$`), names, handler };
  });
}

// Runs the first route that matches. Returns false if none did.
async function route(compiled, ctx) {
  const { method } = ctx.req;
  for (const r of compiled) {
    if (r.method !== method) continue;
    const match = ctx.url.pathname.match(r.regex);
    if (!match) continue;
    ctx.params = Object.fromEntries(r.names.map((name, i) => [name, match[i + 1]]));
    await r.handler(ctx);
    return true;
  }
  return false;
}

module.exports = {
  siteUrl, sendPage, sendJson, redirect, sendPublicFile, handleError,
  readBody, readJson, sendResult, compile, route, UUID,
};
