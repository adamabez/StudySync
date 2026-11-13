// StudySync - API: linking a Canvas account and loading homework (lib/canvas.js).

const canvas = require("../lib/canvas");
const { sendJson, readJson } = require("../lib/http");

module.exports = [
  ["POST", "/api/canvas/connect", ({ req, res, db, userId }) => readJson(req, res, 10_000, async (input) => {
    const result = await canvas.connect(db, userId, input);
    if (result.error) return sendJson(res, { error: result.error }, result.status);
    sendJson(res, result.value, 201);
  })],

  ["DELETE", "/api/canvas/connect", async ({ res, db, userId }) => {
    await canvas.disconnect(db, userId);
    sendJson(res, { ok: true });
  }],

  ["GET", "/api/canvas/status", async ({ res, db }) => sendJson(res, await canvas.status(db))],

  // Calendar Feed only: tick an assignment off as done (body { id, done: true/false })
  ["POST", "/api/canvas/done", ({ req, res, db, userId }) => readJson(req, res, 2_000, async (input) => {
    const result = await canvas.setDone(db, userId, input);
    if (result.error) return sendJson(res, { error: result.error }, result.status);
    sendJson(res, result.value);
  })],

  ["GET", "/api/canvas/assignments", async ({ res, db }) => {
    const result = await canvas.getAssignments(db);
    if (result.error) return sendJson(res, { error: result.error, reconnect: Boolean(result.reconnect) }, result.status);
    sendJson(res, result.value);
  }],
];
