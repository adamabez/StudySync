// StudySync - "Add to my calendar": a private link Google / Apple / Outlook Calendar subscribe to.
//
//   GET  /calendar/<code>.ics        the feed itself (no login: calendar apps fetch it on their own)
//   GET  /api/calendar/link          the student's link (made the first time they ask)
//   POST /api/calendar/link/reset    a new link; the old one stops working
//
// The code is a random profiles.calendar_token, and the database function calendar_feed() only
// ever returns the schedule for that code (supabase/calendar-feed.sql). The feed is built by
// lib/calendarfeed.js for this semester's dates (lib/terms.js).

const crypto = require("crypto");
const auth = require("../lib/auth");
const terms = require("../lib/terms");
const { buildFeed } = require("../lib/calendarfeed");
const { siteUrl, sendJson } = require("../lib/http");

// The database doesn't have the calendar column / function yet (supabase/calendar-feed.sql not run)
const isNotSetUp = (error) => error && (error.code === "42703" || error.code === "PGRST202" || error.code === "42883" ||
  /calendar_token|calendar_feed/.test(error.message || ""));

function linkFor(req, token) {
  const url = `${siteUrl(req)}/calendar/${token}.ics`;
  return { url, webcal: url.replace(/^https?:\/\//, "webcal://") };
}

// The student's code, making one if their profile doesn't have it yet
async function tokenFor(db, userId) {
  const { data, error } = await db.from("profiles").select("calendar_token").maybeSingle();
  if (error) throw error;
  if (data && data.calendar_token) return data.calendar_token;
  const token = crypto.randomUUID();
  const { error: saveError } = await db.from("profiles").upsert({ user_id: userId, calendar_token: token }, { onConflict: "user_id" });
  if (saveError) throw saveError;
  return token;
}

const notSetUp = (res, error) => {
  console.error("Calendar links need supabase/calendar-feed.sql:", error.message || error);
  sendJson(res, { notSetUp: true }, 200); // the page says "not set up yet" instead of an error
};

// Anyone with the link (no login)
const feedRoutes = [
  ["GET", "/calendar/:token(uuid).ics", async ({ req, res, params }) => {
    const { data, error } = await auth.supabaseFor(req).rpc("calendar_feed", { feed_token: params.token });
    if (error && !isNotSetUp(error)) throw error;
    if (error || !data) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("This calendar link doesn't work anymore. Get a new one from the Calendar page in StudySync.");
    }
    const ics = buildFeed(data, await terms.getTerm());
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="studysync.ics"',
      "Cache-Control": "private, max-age=900",
    });
    res.end(ics);
  }],
];

// Logged-in students (ctx.db runs as them)
const apiRoutes = [
  ["GET", "/api/calendar/link", async ({ req, res, db, userId }) => {
    try {
      sendJson(res, linkFor(req, await tokenFor(db, userId)));
    } catch (error) {
      if (!isNotSetUp(error)) throw error;
      notSetUp(res, error);
    }
  }],

  ["POST", "/api/calendar/link/reset", async ({ req, res, db, userId }) => {
    const token = crypto.randomUUID();
    const { error } = await db.from("profiles").upsert({ user_id: userId, calendar_token: token }, { onConflict: "user_id" });
    if (error && isNotSetUp(error)) return notSetUp(res, error);
    if (error) throw error;
    sendJson(res, linkFor(req, token));
  }],
];

module.exports = { feedRoutes, apiRoutes };
