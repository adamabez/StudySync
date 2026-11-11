// StudySync - the AI: answers Virtual Notebook questions about course materials,
// and picks study times for the weekly study plan.
//
// Two providers, same features. Pick one in .env (server.js loads it when it starts;
// never commit .env to git):
//   AI_PROVIDER=gemini      + GEMINI_API_KEY=...        free tier, good for demos (ai-gemini.js)
//   AI_PROVIDER=anthropic   + ANTHROPIC_API_KEY=sk-ant-...  Claude, paid (ai-anthropic.js)
// Without AI_PROVIDER, whichever key is filled in is used (Anthropic if both are).
// AI_PROVIDER set to anything else (a typo) turns AI off rather than guessing.
// The chosen provider never falls back to the other one: no key → AI off, and study
// plans use the built-in algorithm.

const anthropic = require("./ai-anthropic");
const gemini = require("./ai-gemini");

const PROVIDERS = { anthropic, gemini };

// What AI_PROVIDER says: a provider, "" (not set), or null (set to something unknown)
function chosenProvider() {
  const value = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (!value) return "";
  return PROVIDERS[value] || null;
}

function provider() {
  const chosen = chosenProvider();
  if (chosen) return chosen;
  if (chosen === null) return gemini; // unknown value: aiEnabled() is false, this is only for messages
  return !anthropic.hasKey() && gemini.hasKey() ? gemini : anthropic;
}

function aiEnabled() {
  if (chosenProvider() === null) return false;
  return provider().hasKey();
}

// Set when AI_PROVIDER has a value we don't recognize, for the startup message
function providerProblem() {
  return chosenProvider() === null
    ? `AI_PROVIDER="${process.env.AI_PROVIDER.trim()}" in .env isn't recognized (use gemini or anthropic), so AI is off.`
    : null;
}

// For messages like "AI answers are off (no GEMINI_API_KEY in .env)".
// freeTier: Gemini without GEMINI_PAID=true in .env, so the notebook shows its demo disclaimer.
function providerInfo() {
  const p = provider();
  const freeTier = p === gemini && chosenProvider() !== null && (process.env.GEMINI_PAID || "").trim().toLowerCase() !== "true";
  return { name: p.name, keyName: p.keyName, freeTier };
}

// ---------- Virtual Notebook ----------

const SYSTEM_PROMPT = `You are the Virtual Notebook inside StudySync, a study app for students. The student has shared their course materials with you as documents.

Answer using only those materials. If the materials don't cover what the student asked, say so plainly rather than filling the gap from general knowledge; after saying so, you may add a short general explanation, clearly labeled as not coming from their materials.

Talk like a friendly, sharp study partner, not a textbook or a report. Answer the question directly in the first sentence, in plain, natural language, then add what helps them understand it. Match the length to the question: a quick question gets a few sentences, not a structured document. Use **bold** for key terms, and lists only when there are really several parallel items; use "#" headings only for long answers like a study guide. Don't open with filler like "Great question" or "Based on the provided materials", and don't repeat the question back. When it would help, end with one short, specific suggestion for what to look at or ask next. Don't use tables or code blocks unless the material itself contains code.

Write math and formulas as plain text with Unicode symbols, for example x = ½at² + v₀t + x₀, F = ma, Δv, θ, √2, ≤, ×. Never use LaTeX or $ signs around math: the app can't display LaTeX.`;

// sources: [{ source, content }]   history: [{ role, content }]   question: string
// Returns { answer, citations } on success or { error } if the AI couldn't answer.
// The answer has ⟦n⟧ markers; citations are [{ n, source, page, quote }].
function askNotebook({ sources, history, question }) {
  return provider().askNotebook({ system: SYSTEM_PROMPT, sources, history, question });
}

// ---------- Study planner: the AI picks study sessions from the student's free time ----------
// studyplan.js gives it the free windows (worked out by public/planner.js) and checks
// whatever comes back, so the AI can't double-book a class. If anything goes wrong,
// studyplan.js falls back to the planner's own algorithm.

const PLAN_SYSTEM_PROMPT = `You plan a student's weekly study sessions in StudySync, a study app.

You get the student's weekly study goal in minutes, the free windows in their week, their classes and other commitments (for context only), and optional notes in their own words about how they like to study.

Choose study sessions that add up to the goal:
- Every session must fit completely inside one free window. Never go outside the windows.
- Each session is 60 to 120 minutes (it can be shorter only if less than 60 minutes of the goal is left). Start sessions on the hour or half hour.
- Leave at least 30 minutes between two sessions on the same day, and put at most 3 sessions on one day.
- Total within 30 minutes of the goal. If the free windows can't fit the whole goal, plan as much as fits.
- Unless the student's notes say otherwise, prefer calm times: afternoons (1-5 PM) first, then evenings and mornings, and avoid lunchtime and the very start or end of the day. Spread sessions across the week instead of piling them onto a few days.
- Follow the student's notes whenever the windows allow it. They matter more than the default preferences above.

For each session, write a short, friendly reason (under 15 words) addressed to the student, e.g. "Right after Biology, while the lecture is fresh."`;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    sessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "string", enum: DAY_KEYS },
          start: { type: "string", description: '24-hour time, "HH:MM"' },
          end: { type: "string", description: '24-hour time, "HH:MM"' },
          reason: { type: "string" },
        },
        required: ["day", "start", "end", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["sessions"],
  additionalProperties: false,
};

// Returns [{ day, start, end, reason }] as the AI suggested them (not yet checked),
// or throws if the AI couldn't answer.
function planStudyWeek({ goalMinutes, windows, calendar, notes }) {
  const details = {
    weekly_goal_minutes: goalMinutes,
    free_windows: windows,
    schedule: calendar
      .filter((item) => item.start)
      .map((item) => ({ name: item.name, kind: item.kind, days: item.days, start: item.start, end: item.end })),
    student_notes: notes || "(none)",
  };
  return provider().planStudyWeek({
    system: PLAN_SYSTEM_PROMPT,
    schema: PLAN_SCHEMA,
    prompt: "Plan my study sessions for the week.\n\n" + JSON.stringify(details, null, 2),
  });
}

// Turn an API error into a message a student can act on
function explainError(error) {
  return anthropic.explainError(error) || gemini.explainError(error) || "Something went wrong asking the AI.";
}

module.exports = { aiEnabled, providerInfo, providerProblem, askNotebook, planStudyWeek, explainError };
