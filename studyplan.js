// StudySync - the weekly study plan on the landing page ("On my own").
//
// With an AI key in .env (Gemini or Anthropic, see ai.js): the AI picks study times from the student's free
// windows, following their notes ("I'm a night owl"). Every AI plan is checked against
// the real schedule, and saved so the AI only runs again when the schedule, goal or
// notes change.
// Without a key, or if the AI fails or suggests something that doesn't fit: the
// planner's own algorithm (public/planner.js), which fills calm afternoons first.

const crypto = require("crypto");
const planner = require("./public/planner");
const ai = require("./ai");

const PLAN_VERSION = 2; // bump to throw away every saved AI plan (e.g. after changing the prompt)

// Returns { source: "ai" | "algorithm", goalMinutes, found, sessions: [{ day, start, end, label, reason? }] }
async function getStudyPlan(db, userId, calendar, profile) {
  const goalMinutes = profile.weeklyHours * 60;
  const sessionLength = profile.sessionLength;
  const algorithm = () => withLabels({ source: "algorithm", goalMinutes, ...planner.planStudyTimes(calendar, goalMinutes, sessionLength) });
  if (!ai.aiEnabled()) return algorithm();

  // Same schedule, goal, session length and notes as last time? Reuse the saved AI plan.
  const key = planKey(calendar, goalMinutes, profile.studyNotes, sessionLength);
  const saved = await loadSavedPlan(db);
  if (saved && saved.key === key) return withLabels(saved.plan);

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
    return withLabels(plan);
  } catch (error) {
    console.error("AI study plan failed, using the algorithm instead:", error.message || error);
    return algorithm();
  }
}

// A fingerprint of everything the plan depends on
function planKey(calendar, goalMinutes, notes, sessionLength) {
  const timed = calendar
    .filter((item) => item.start)
    .map((item) => [item.name, [...item.days].sort().join(","), item.start, item.end].join("|"))
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

module.exports = { getStudyPlan };
