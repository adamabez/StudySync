// StudySync - API: solo notes, your own private notes on the Notes page (lib/solonotes.js).
// Group notes are in routes/groups.js.

const solo = require("../lib/solonotes");
const { sendJson, readJson, sendResult } = require("../lib/http");
const { writeAllowed } = require("../lib/limits");

module.exports = [
  // { notes } — or { notes: [], notSetUp: true } before supabase/solo-notes.sql is run
  ["GET", "/api/solo-notes", async ({ res, db }) => {
    const notes = await solo.list(db);
    sendJson(res, notes ? { notes } : { notes: [], notSetUp: true });
  }],

  ["POST", "/api/solo-notes", ({ req, res, db, userId }) => {
    if (!writeAllowed(userId)) return sendJson(res, { error: "That's a lot of changes at once. Wait a few seconds and try again." }, 429);
    return readJson(req, res, 50_000, async (input) => sendResult(res, await solo.add(db, input), 201));
  }],

  ["DELETE", "/api/solo-notes/:id(uuid)", async ({ res, db, params }) => {
    await solo.remove(db, params.id);
    sendJson(res, { ok: true });
  }],
];
