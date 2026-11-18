// YoraBora - API: profiles (lib/profiles.js). Your photo, major, year and classes, and what
// you share with your study groups; classmates' cards and photos (only what they chose to share,
// and only if you share a study group).

const profiles = require("../lib/profiles");
const { sendJson, readJson } = require("../lib/http");
const { writeAllowed } = require("../lib/limits");

const NOT_SET_UP = "Profiles aren't switched on yet. Try again later.";
const TOO_FAST = "That's a lot of changes at once. Wait a few seconds and try again.";

// Runs a change that returns { value } or { error }
async function change(res, work) {
  try {
    const result = await work();
    if (result.error) return sendJson(res, { error: result.error }, 400);
    sendJson(res, result.value);
  } catch (error) {
    if (!profiles.isNotSetUp(error)) throw error;
    console.error("Profiles need supabase/profiles.sql run in Supabase:", error.message);
    sendJson(res, { error: NOT_SET_UP }, 503);
  }
}

module.exports = [
  // Your own profile, for Account settings
  ["GET", "/api/profile/card", async ({ res, db, userId }) => sendJson(res, await profiles.getMyProfile(db, userId))],

  // Major, year and what you share: { major?, year?, share?: { photo, major, year, classes } }
  ["POST", "/api/profile/card", ({ req, res, db, userId }) => readJson(req, res, 5_000, (input) => {
    if (!writeAllowed(userId)) return sendJson(res, { error: TOO_FAST }, 429);
    return change(res, () => profiles.updateMyProfile(db, userId, input));
  })],

  // A new photo: { image: "data:image/webp;base64,..." }, already shrunk by the browser
  ["POST", "/api/profile/photo", ({ req, res, db, userId }) => readJson(req, res, 400_000, (input) => {
    if (!writeAllowed(userId)) return sendJson(res, { error: TOO_FAST }, 429);
    return change(res, () => profiles.savePhoto(db, userId, input.image));
  })],

  ["DELETE", "/api/profile/photo", ({ res, db, userId }) =>
    change(res, async () => ({ value: await profiles.removePhoto(db, userId) }))],

  // A classmate's card (only if you share a study group)
  ["GET", "/api/members/:profile(uuid)", async ({ res, db, params }) => {
    const card = await profiles.memberProfile(db, params.profile);
    if (!card) return sendJson(res, { error: "You can only see profiles of people in your study groups." }, 404);
    sendJson(res, card);
  }],

  ["POST", "/api/members/:profile(uuid)/report", ({ req, res, db, userId, params }) => readJson(req, res, 5_000, (input) => {
    if (!writeAllowed(userId)) return sendJson(res, { error: TOO_FAST }, 429);
    return change(res, async () => {
      const result = await profiles.reportPhoto(db, params.profile, input.reason, req.headers["user-agent"], req.user && req.user.email);
      return result.error ? result : { value: { ok: true } };
    });
  })],

  // A photo (the storage rules decide whether you may see it). ?v= changes when it does, so
  // browsers can keep it for a day.
  ["GET", "/api/photos/:profile(uuid)", async ({ res, db, params }) => {
    const file = await profiles.photoFile(db, params.profile);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("No photo");
    }
    res.writeHead(200, { "Content-Type": file.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" });
    res.end(file.bytes);
  }],
];
