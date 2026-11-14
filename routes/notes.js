// StudySync - API: private notes, only you can see them (lib/privatenotes.js), and switching a
// note between private and shared with its group. Group notes themselves are in routes/groups.js.

const priv = require("../lib/privatenotes");
const { sendJson, readJson, sendResult } = require("../lib/http");
const { writeAllowed } = require("../lib/limits");

const TOO_FAST = { error: "That's a lot of changes at once. Wait a few seconds and try again." };

module.exports = [
  // { notes } — or { notes: [], notSetUp: true } before supabase/private-notes.sql is run
  ["GET", "/api/private-notes", async ({ res, db }) => {
    const notes = await priv.list(db);
    sendJson(res, notes ? { notes } : { notes: [], notSetUp: true });
  }],

  ["POST", "/api/private-notes", ({ req, res, db, userId }) => {
    if (!writeAllowed(userId)) return sendJson(res, TOO_FAST, 429);
    return readJson(req, res, 50_000, async (input) => sendResult(res, await priv.add(db, userId, input), 201));
  }],

  ["DELETE", "/api/private-notes/:id(uuid)", async ({ res, db, params }) => {
    await priv.remove(db, params.id);
    sendJson(res, { ok: true });
  }],

  // Private → shared with its group (answers with the group note)
  ["POST", "/api/private-notes/:id(uuid)/share", async ({ res, db, userId, params }) => {
    if (!writeAllowed(userId)) return sendJson(res, TOO_FAST, 429);
    sendResult(res, await priv.share(db, userId, params.id));
  }],

  // Your group note → private (answers with the private note)
  ["POST", "/api/groups/:group(uuid)/notes/:note(uuid)/private", async ({ res, db, userId, params }) => {
    if (!writeAllowed(userId)) return sendJson(res, TOO_FAST, 429);
    sendResult(res, await priv.makePrivate(db, userId, params.group, params.note));
  }],
];
