// StudySync - API: study groups (lib/groups.js) and meeting up (lib/meetups.js).
// Students are matched automatically; they never pick a group. Only members can see a group.

const groups = require("../lib/groups");
const meetups = require("../lib/meetups");
const onboarding = require("../lib/onboarding");
const { sendJson, readJson, sendResult } = require("../lib/http");
const { writeAllowed } = require("../lib/limits");

const NOT_IN_GROUP = "That group doesn't exist, or you're not in it.";

// A route for one group (/api/groups/<id>/...): checks the student is in it and puts it in ctx.group
const groupRoute = (method, rest, handler) => [method, "/api/groups/:group(uuid)" + rest, async (ctx) => {
  ctx.group = await groups.getGroup(ctx.db, ctx.params.group, ctx.userId);
  if (!ctx.group) return sendJson(ctx.res, { error: NOT_IN_GROUP }, 404);
  return handler(ctx);
}];

// Meeting up: the spot and suggestions, RSVPs, moving a week's session, session chat.
// Changes are rate limited, and answer with the fresh { meetup, spots, rsvps, moves } so the
// page just redraws. ctx gets:
//   run(work)          → runs work, explaining if the meetup tables aren't set up yet
//   body(limit, work)  → reads the JSON the browser sent, then run(work(input))
//   reply(result, status) → { error } as a 400, otherwise the fresh meetup info
const meetupRoute = (method, rest, handler) => groupRoute(method, rest, (ctx) => {
  const { req, res, db, group, userId } = ctx;
  if (method !== "GET" && !writeAllowed(userId)) {
    return sendJson(res, { error: "That's a lot of changes at once. Wait a few seconds and try again." }, 429);
  }
  ctx.run = (work) => work().catch((error) => {
    if (!meetups.isMissingTable(error)) throw error;
    console.error("Meetups need the latest supabase/schema.sql:", error.message || error);
    sendJson(res, { error: "Meetups aren't set up yet. Run the latest supabase/schema.sql in Supabase.", notSetUp: true }, 503);
  });
  ctx.body = (limit, work) => readJson(req, res, limit, (input) => ctx.run(() => work(input)));
  ctx.reply = async (result, status = 200) => {
    if (result && result.error) return sendJson(res, { error: result.error }, 400);
    const info = await meetups.getInfo(db, group, userId);
    sendJson(res, { ...info, ...(result && typeof result.value === "object" ? result.value : {}) }, status);
  };
  return handler(ctx);
});

// Session chat answers with messages, not the whole meetup info
const answer = (res, result, status = 200) =>
  result.error ? sendJson(res, { error: result.error }, 400) : sendJson(res, result.value, status);

module.exports = [
  // Opening the landing page tries to match the student, then shows their groups
  ["POST", "/api/groups/match", async ({ res, db, userId }) => {
    await groups.match(db);
    sendJson(res, await groups.listMyGroups(db, userId));
  }],

  // Each of your classes and whether you're in a group for it yet (landing page "still looking")
  ["GET", "/api/groups/classes", async ({ res, db }) => sendJson(res, await groups.listClassGroups(db))],

  // The Notes page: every group's notes in one place
  ["GET", "/api/notes", async ({ res, db, userId }) => sendJson(res, await groups.listAllNotes(db, userId))],

  // --- One group and its shared notes ---
  groupRoute("GET", "", async ({ res, db, group, userId }) => {
    // A missing Discord table (schema.sql not re-run yet) shouldn't break the group page
    const classDiscord = !groups.DISCORD_ENABLED ? null : groups.getClassDiscordLink(db, group)
      .then((link) => groups.discordForBrowser(link))
      .catch((error) => { console.error("Class Discord lookup failed (run supabase/schema.sql again?):", error.message || error); return null; });
    const [notes, discord] = await Promise.all([groups.listNotes(db, group, userId), classDiscord]);
    const { members, ...details } = group;
    sendJson(res, {
      group: { ...details, discord, discordEnabled: groups.DISCORD_ENABLED, members: members.map(groups.memberForBrowser) },
      notes,
    });
  }),

  groupRoute("POST", "/notes", ({ req, res, db, group, userId }) => readJson(req, res, 50_000, async (input) => {
    sendResult(res, await groups.addNote(db, group, userId, input), 201);
  })),

  groupRoute("DELETE", "/notes/:note(uuid)", async ({ res, db, params }) => {
    await groups.removeNote(db, params.group, params.note);
    sendJson(res, { ok: true });
  }),

  // The class's Discord server (shared by every group in the class): anyone in it can set,
  // change or remove the invite link. Paused for now: groups.DISCORD_ENABLED
  groupRoute("PUT", "/discord", ({ req, res, db, group }) => {
    if (!groups.DISCORD_ENABLED) return sendJson(res, { error: "Not found" }, 404);
    return readJson(req, res, 2_000, async (input) => sendResult(res, await groups.setDiscord(db, group, input)));
  }),

  // --- Meeting up ---
  meetupRoute("GET", "/meetup", ({ run, reply }) => run(() => reply(null))),
  meetupRoute("POST", "/meetup", ({ body, reply, db, group, userId }) =>
    body(2_000, async (input) => reply(await meetups.setMeetup(db, group, userId, input)))),
  meetupRoute("DELETE", "/meetup", ({ run, reply, db, group }) =>
    run(async () => { await meetups.clearMeetup(db, group); await reply(null); })),

  meetupRoute("POST", "/spots", ({ body, reply, db, group, userId }) =>
    body(2_000, async (input) => reply(await meetups.addSpot(db, group, userId, input), 201))),
  meetupRoute("POST", "/spots/:spot(uuid)/vote", ({ body, reply, db, group, userId, params }) =>
    body(1_000, async (input) => reply(await meetups.setVote(db, group, userId, params.spot, input.on !== false)))),
  meetupRoute("DELETE", "/spots/:spot(uuid)", ({ run, reply, db, group, params }) =>
    run(async () => { await meetups.removeSpot(db, group, params.spot); await reply(null); })),

  meetupRoute("POST", "/rsvp", ({ body, reply, db, group, userId }) =>
    body(1_000, async (input) => reply(await meetups.setRsvp(db, group, userId, input)))),

  // Times in the next week when every member is free, and moving one week's session there
  meetupRoute("GET", "/slots", ({ run, res, db, group }) => run(async () => sendJson(res, await meetups.freeSlots(db, group)))),
  meetupRoute("POST", "/move", ({ body, reply, db, group }) =>
    body(1_000, async (input) => reply(await meetups.moveSession(db, group, input)))),
  meetupRoute("DELETE", "/move", ({ run, reply, db, group, url }) =>
    run(async () => reply(await meetups.undoMove(db, group, { sessionDate: url.searchParams.get("session") })))),

  // Session chat
  meetupRoute("GET", "/messages", ({ run, res, url, db, group, userId }) => run(async () =>
    answer(res, await meetups.listMessages(db, group, userId, url.searchParams.get("session"), url.searchParams.get("after"))))),
  meetupRoute("POST", "/messages", async ({ req, res, body, db, group, userId }) => {
    const profile = await onboarding.getProfile(db, userId);
    if (!onboarding.displayName(profile, req.user)) {
      return sendJson(res, { error: "Add your name in Account settings first, so your group knows who's talking.", needsName: true }, 400);
    }
    return body(5_000, async (input) => answer(res, await meetups.addMessage(db, group, userId, input), 201));
  }),
  meetupRoute("DELETE", "/messages/:message(uuid)", ({ run, res, db, group, params }) =>
    run(async () => { await meetups.removeMessage(db, group, params.message); sendJson(res, { ok: true }); })),
];
