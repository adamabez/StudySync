// StudySync - the weekly study plan on the landing page ("On my own").
//
// With an AI key in .env (Gemini or Anthropic, see ai.js): the AI picks study times from the student's free
// windows, following their notes ("I'm a night owl"). Every AI plan is checked against
// the real schedule, and saved so the AI only runs again when the schedule, goal or
// notes change.
// Without a key, or if the AI fails or suggests something that doesn't fit: the
// planner's own algorithm (public/planner.js), which fills calm afternoons first.

const crypto = require("crypto");
const planner = require("../public/planner");
const ai = require("./ai");

// After the AI fails (busy, slow), plan with the algorithm for a while instead of making
// every page load wait for it again
const AI_COOLDOWN_MS = 10 * 60 * 1000;
let aiFailedAt = 0;

const PLAN_VERSION = 2; // bump to throw away every saved AI plan (e.g. after changing the prompt)

// Returns { source: "ai" | "algorithm", goalMinutes, found, sessions: [{ day, start, end, label, reason? }],
//           weeklyGoalMinutes, groupMinutes }.
// groupMeetings ([{ days, start, end }], when studying in a group): they count toward the weekly
// goal, and the plan is solo time for the rest, around them. goalMinutes is that solo part.
async function getStudyPlan(db, userId, fullCalendar, profile, groupMeetings = []) {
  const meetings = groupMeetings.filter((g) => g.start && g.end && Array.isArray(g.days) && g.days.length);
  const groupMinutes = meetings.reduce((sum, g) => sum + g.days.length * (planner.toMinutes(g.end) - planner.toMinutes(g.start)), 0);
  const weeklyGoalMinutes = profile.weeklyHours * 60;
  const extra = { weeklyGoalMinutes, groupMinutes };
  const calendar = planCalendar(fullCalendar, meetings);
  const goalMinutes = Math.max(0, weeklyGoalMinutes - groupMinutes);
  if (goalMinutes === 0) return { source: "algorithm", goalMinutes, found: 0, sessions: [], ...extra };
  const sessionLength = profile.sessionLength;
  const algorithm = () => withLabels({ source: "algorithm", goalMinutes, ...planner.planStudyTimes(calendar, goalMinutes, sessionLength), ...extra });
  if (!ai.aiEnabled()) return algorithm();
  const aiResting = Date.now() - aiFailedAt < AI_COOLDOWN_MS;

  // Same schedule, goal, session length and notes as last time? Reuse the saved AI plan.
  const key = planKey(calendar, goalMinutes, profile.studyNotes, sessionLength);
  const saved = await loadSavedPlan(db);
  if (saved && saved.key === key) return withLabels({ ...saved.plan, ...extra });
  if (aiResting) return algorithm();

  try {
    const sessions = await ai.planStudyWeek({
      goalMinutes,
      windows: planner.freeWindows(calendar),
      calendar,
      notes: profile.studyNotes,
      length: planner.lengthFor(sessionLength),
    });
    const problem = planner.checkPlan(calendar, sessions, goalMinutes, sessionLength);
    if (problem) throw new Error("AI plan didn't fit: " + problem);

    const plan = {
      source: "ai",
      goalMinutes,
      found: sessions.reduce((sum, s) => sum + planner.toMinutes(s.end) - planner.toMinutes(s.start), 0),
      sessions: sortSessions(sessions.map(({ day, start, end, reason }) => ({ day, start, end, reason: String(reason).slice(0, 150) }))),
    };
    await savePlan(db, userId, key, plan);
    return withLabels({ ...plan, ...extra });
  } catch (error) {
    console.error("AI study plan failed, using the algorithm instead (and for the next 10 minutes):", error.message || error);
    aiFailedAt = Date.now();
    return algorithm();
  }
}

// What the week's solo sessions plan around: weekly items, this week's one-time items,
// and group meetings
function planCalendar(fullCalendar, meetings = []) {
  return [
    ...planner.thisWeek(fullCalendar),
    ...meetings
      .filter((g) => g.start && g.end && Array.isArray(g.days))
      .map((g) => ({ name: "Study group", kind: "other", days: g.days, start: g.start, end: g.end })),
  ];
}

// ---------- Quick edits to this week's solo sessions (move / length / skip) ----------
// Saved in profiles.study_edits as { week: "2026-11-09", items: { "fri|13:00": { skip: true } |
// { day, start, end } } }, keyed by the session as planned. Only this week's edits apply: next
// week starts from a fresh plan. Edits whose session isn't planned anymore are ignored.

const sessionKey = (s) => s.day + "|" + s.start;
const LENGTH_CHOICES = [30, 45, 60, 90, 120];

// The plan with this week's edits applied. Every session gets `key` (as planned) and `edited`;
// skipped ones move to `skipped` so the page can offer Undo.
function applyEdits(plan, edits) {
  const items = edits && edits.week === planner.weekStart() ? edits.items || {} : {};
  const sessions = [];
  const skipped = [];
  for (const s of plan.sessions) {
    const key = sessionKey(s);
    const change = items[key];
    if (change && change.skip) skipped.push({ ...s, key });
    else if (change && change.day) sessions.push({ ...s, day: change.day, start: change.start, end: change.end, label: planner.labelFor(change.start, change.end), reason: undefined, key, edited: true });
    else sessions.push({ ...s, key, edited: false });
  }
  const found = sessions.reduce((sum, s) => sum + planner.toMinutes(s.end) - planner.toMinutes(s.start), 0);
  // suggestedFound: what was planned before edits (so skipping isn't shown as "didn't fit")
  return { ...plan, sessions: sortSessions(sessions), skipped, found, suggestedFound: plan.found };
}

// Free gaps on a day, leaving out the session being edited
function gapsFor(calendar, sessions, day, exceptKey) {
  const others = sessions.filter((s) => s.day === day && s.key !== exceptKey).map((s) => [planner.toMinutes(s.start), planner.toMinutes(s.end)]);
  return planner.freeGaps(calendar, day, others);
}

// For the ✎ menu: other open slots of the same length (best one per day, calmest first) and
// the lengths that fit where it is now
function editOptions(calendar, sessions, key) {
  const target = sessions.find((s) => s.key === key);
  if (!target) return null;
  const start = planner.toMinutes(target.start);
  const length = planner.toMinutes(target.end) - start;

  const moves = [];
  for (const day of planner.DAY_KEYS) {
    let best = null;
    for (const gap of gapsFor(calendar, sessions, day, key)) {
      for (let m = Math.ceil(gap.from / 30) * 30; m + length <= gap.to; m += 30) {
        if (day === target.day && m < start + length && m + length > start) continue; // overlaps where it is now
        const score = planner.calmScore(m, m + length);
        if (!best || score > best.score) best = { day, start: planner.toTime(m), end: planner.toTime(m + length), score };
      }
    }
    if (best) moves.push(best);
  }
  moves.sort((a, b) => b.score - a.score);

  const here = gapsFor(calendar, sessions, target.day, key).find((g) => start >= g.from && start < g.to);
  const lengths = LENGTH_CHOICES.filter((min) => here && start + min <= here.to);
  return {
    moves: moves.slice(0, 5).map(({ day, start: s, end }) => ({ day, start: s, end, label: planner.labelFor(s, end) })),
    lengths,
    current: length,
  };
}

// Check an edit from the browser. input: { key, action: "move" | "length" | "skip" | "reset",
// day?, start?, end?, minutes? }. Returns { value: the edit to store (null = remove it) } or { error }.
function checkEdit(calendar, sessions, skipped, input) {
  const key = typeof input.key === "string" ? input.key : "";
  const target = sessions.find((s) => s.key === key) || skipped.find((s) => s.key === key);
  if (!target) return { error: "That study session isn't in this week's plan anymore. Refresh the page." };
  if (input.action === "reset") return { value: null };
  if (input.action === "skip") return { value: { skip: true } };

  let day = target.day;
  let start = target.start;
  let end = target.end;
  if (input.action === "move") {
    if (!planner.DAY_KEYS.includes(input.day) || !planner.isTime(input.start) || !planner.isTime(input.end)) return { error: "Pick a time to move it to." };
    ({ day, start, end } = input);
  } else if (input.action === "length") {
    const minutes = Number(input.minutes);
    if (!LENGTH_CHOICES.includes(minutes)) return { error: "Pick a length." };
    end = planner.toTime(planner.toMinutes(start) + minutes);
  } else {
    return { error: "Unknown change." };
  }
  const from = planner.toMinutes(start);
  const to = planner.toMinutes(end);
  if (to <= from || to - from > 120) return { error: "Study sessions are up to 2 hours." };
  const fits = gapsFor(calendar, sessions, day, key).some((g) => from >= g.from && to <= g.to);
  if (!fits) return { error: "That time isn't free anymore. Pick another one." };
  return { value: { day, start, end } };
}

// Database: load / save this week's edits (null when profiles.study_edits doesn't exist yet)
const missingEditsColumn = (error) => error && /study_edits/.test(error.message || "");
async function loadEdits(db) {
  const { data, error } = await db.from("profiles").select("study_edits").maybeSingle();
  if (missingEditsColumn(error)) return { ready: false, edits: null };
  if (error) throw error;
  return { ready: true, edits: data ? data.study_edits : null };
}
async function saveEdit(db, userId, edits, key, value) {
  const week = planner.weekStart();
  const items = edits && edits.week === week ? { ...edits.items } : {};
  if (value) items[key] = value;
  else delete items[key];
  const { error } = await db.from("profiles").upsert({ user_id: userId, study_edits: { week, items } }, { onConflict: "user_id" });
  if (missingEditsColumn(error)) return { error: "Editing study times isn't set up yet.", status: 503 };
  if (error) throw error;
  return { value: true };
}

// The week's plan with edits applied, plus what editing needs (server.js routes)
async function editedPlan(db, userId, fullCalendar, profile, meetings = []) {
  const [plan, saved] = await Promise.all([getStudyPlan(db, userId, fullCalendar, profile, meetings), loadEdits(db)]);
  return { plan: { ...applyEdits(plan, saved.edits), editable: saved.ready }, calendar: planCalendar(fullCalendar, meetings), edits: saved.edits };
}

// A fingerprint of everything the plan depends on
function planKey(calendar, goalMinutes, notes, sessionLength) {
  const timed = calendar
    .filter((item) => item.start)
    .map((item) => [item.name, [...item.days].sort().join(","), item.start, item.end, item.date || ""].join("|"))
    .sort();
  const text = JSON.stringify({ v: PLAN_VERSION, timed, goalMinutes, notes: notes || "", length: sessionLength || "" });
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function loadSavedPlan(db) {
  const { data, error } = await db.from("profiles").select("study_plan, study_plan_key").maybeSingle();
  if (error) throw error;
  return data && data.study_plan ? { key: data.study_plan_key, plan: data.study_plan } : null;
}

async function savePlan(db, userId, key, plan) {
  const { error } = await db
    .from("profiles")
    .upsert({ user_id: userId, study_plan: plan, study_plan_key: key }, { onConflict: "user_id" });
  if (error) console.error("Couldn't save the study plan:", error.message); // still show it this time
}

function sortSessions(sessions) {
  return sessions.sort((a, b) => planner.DAY_KEYS.indexOf(a.day) - planner.DAY_KEYS.indexOf(b.day) || a.start.localeCompare(b.start));
}

// Add "Afternoon" / "Evening"... to each session for the page
function withLabels(plan) {
  return { ...plan, sessions: plan.sessions.map((s) => ({ ...s, label: planner.labelFor(s.start, s.end) })) };
}

module.exports = { getStudyPlan, planCalendar, applyEdits, editOptions, checkEdit, loadEdits, saveEdit, editedPlan };
