// StudySync - API: the student's profile (lib/onboarding.js), their weekly study plan and
// its quick edits (lib/studyplan.js), and "I studied" checkmarks (lib/studylog.js).

const ai = require("../lib/ai");
const schedule = require("../lib/schedule");
const onboarding = require("../lib/onboarding");
const groups = require("../lib/groups");
const studyplan = require("../lib/studyplan");
const studylog = require("../lib/studylog");
const { sendJson, readJson, sendResult } = require("../lib/http");

// Everything the plan depends on: schedule, profile, and group meetings when in a group.
// In a study group its meetings count toward the weekly goal; the plan is solo time for the rest.
async function planInputs(db, userId) {
  const [calendar, profile] = await Promise.all([schedule.loadClasses(db), onboarding.getProfile(db, userId)]);
  const meetings = profile.preference === "group" ? await groups.listMyGroups(db, userId) : [];
  return { calendar, profile, meetings };
}

async function editedPlan(db, userId) {
  const { calendar, profile, meetings } = await planInputs(db, userId);
  return studyplan.editedPlan(db, userId, calendar, profile, meetings);
}

module.exports = [
  // First-login setup and study preference.
  // aiScheduling: whether study times are planned by the AI (needs an AI key, see lib/ai.js)
  ["GET", "/api/profile", async ({ req, res, db, userId }) => {
    const profile = await onboarding.getProfile(db, userId);
    sendJson(res, { ...profile, displayName: onboarding.displayName(profile, req.user), aiScheduling: ai.aiEnabled() });
  }],

  ["POST", "/api/profile", ({ req, res, db, userId }) => readJson(req, res, 10_000, async (input) => {
    let result;
    try {
      result = await onboarding.updateProfile(db, userId, input);
    } catch (error) {
      if (error.code !== "SESSION_LENGTH_COLUMN") throw error;
      console.error(error.message);
      return sendJson(res, { error: "Session length can't be saved yet. Try again later." }, 503);
    }
    if (result.error) return sendJson(res, { error: result.error }, 400);
    await groups.matchQuietly(db); // wants a group now → find one; prefers alone → leave theirs
    sendJson(res, result.value);
  })],

  ["GET", "/api/study-plan", async ({ res, db, userId }) => {
    const { plan } = await editedPlan(db, userId);
    sendJson(res, plan);
  }],

  // Quick edits to this week's solo sessions: the ✎ menu
  ["GET", "/api/study-edits/options", async ({ res, url, db, userId }) => {
    const { plan, calendar: busy } = await editedPlan(db, userId);
    const options = studyplan.editOptions(busy, plan.sessions, url.searchParams.get("key"));
    if (!options) return sendJson(res, { error: "That study session isn't in this week's plan anymore. Refresh the page." }, 404);
    sendJson(res, options);
  }],

  ["POST", "/api/study-edits", ({ req, res, db, userId }) => readJson(req, res, 2_000, async (input) => {
    const { plan, calendar: busy, edits } = await editedPlan(db, userId);
    const checked = studyplan.checkEdit(busy, plan.sessions, plan.skipped, input);
    if (checked.error) return sendJson(res, { error: checked.error }, 400);
    const saved = await studyplan.saveEdit(db, userId, edits, input.key, checked.value);
    if (saved.error) return sendJson(res, { error: saved.error }, saved.status || 400);
    sendJson(res, { ok: true });
  })],

  // "I studied" checkmarks on solo study sessions
  ["GET", "/api/study-log", async ({ res, url, db }) => {
    const result = await studylog.listDone(db, url.searchParams.get("from"), url.searchParams.get("to"));
    if (result.error) return sendJson(res, { error: result.error }, 400);
    sendJson(res, result.value);
  }],

  ["POST", "/api/study-log", ({ req, res, db, userId }) => readJson(req, res, 2_000, async (input) => {
    sendResult(res, await studylog.setDone(db, userId, input));
  })],

  // Study times for the dashboard calendar: the weekly study plan, same as the landing page
  // shows. In a study group: its weekly meetings, plus solo sessions for the rest of the goal.
  ["GET", "/api/study-times", async ({ res, db, userId }) => {
    const [calendar, profile, myGroups] = await Promise.all([
      schedule.loadClasses(db),
      onboarding.getProfile(db, userId),
      groups.listMyGroups(db, userId),
    ]);
    const inGroups = profile.preference === "group" ? myGroups : [];
    const meetings = inGroups.map((g) => ({
      type: "group",
      id: g.id,
      name: g.name,
      days: g.days,
      start: g.start,
      end: g.end,
      note: g.members.length + (g.members.length === 1 ? " member" : " members"),
    }));
    const { plan } = await studyplan.editedPlan(db, userId, calendar, profile, inGroups);
    sendJson(res, [...meetings, ...plan.sessions.map((s) => ({
      type: "study",
      name: "Study time",
      days: [s.day],
      start: s.start,
      end: s.end,
      note: s.reason || s.label,
      key: s.key,        // for the ✎ menu
      edited: s.edited,
      editable: plan.editable,
    }))]);
  }],
];
