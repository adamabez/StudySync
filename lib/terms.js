// StudySync - this semester's dates: the first and last day of classes, and holidays with no
// classes. The calendar page and the "add to my calendar" feed repeat classes between them.
//
// First / last day: read from Sac State's class schedule (lib/sections.js), whose sections say
// when they start and end meeting. The most common dates across a few big subjects are the
// semester's regular dates (short-session classes don't change them). If the schedule can't be
// reached, TERMS below is used, and failing that a rough guess from the month.
//
// Holidays: the class schedule doesn't list them, so they're kept here by hand. ★ Each new
// semester, check them against the official calendar (catalog.csus.edu/academic-calendar)
// and add the next term. `checked: false` means they haven't been confirmed yet.

const sections = require("./sections");

const TERMS = {
  "fall-2026": {
    start: "2026-08-31", // from the class schedule
    end: "2026-12-11",
    checked: false,
    holidays: [
      { date: "2026-09-07", name: "Labor Day" },
      { date: "2026-11-11", name: "Veterans Day" },
      { from: "2026-11-26", to: "2026-11-27", name: "Thanksgiving" },
    ],
  },
  "spring-2027": {
    start: "2027-01-25",
    end: null, // filled in from the class schedule once it's out
    checked: false,
    holidays: [],
  },
};

const SUBJECTS = ["ENGL", "MATH"]; // big subjects, so the most common dates are the regular ones
const CACHE_MS = 12 * 60 * 60 * 1000;
let cached = null; // { at, term, promise }

// "08/31/2026" → "2026-08-31"
const toIso = (us) => {
  const m = String(us || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

// Every day from..to (inclusive), as "YYYY-MM-DD"
function daysBetween(from, to) {
  const out = [];
  const d = new Date(from + "T12:00:00Z");
  const end = new Date((to || from) + "T12:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

async function datesFromSchedule(term) {
  const starts = [], ends = [];
  for (const subject of SUBJECTS) {
    const courses = await sections.fetchSubject(term, subject);
    for (const course of courses) {
      for (const s of course.sections || []) {
        starts.push(toIso(s.class_meeting_start_date));
        ends.push(toIso(s.class_meeting_end_date));
      }
    }
  }
  return { start: mostCommon(starts), end: mostCommon(ends) };
}

// A rough guess when nothing else is known
function guess(term) {
  const [season, year] = term.split("-");
  if (season === "fall") return { start: `${year}-08-25`, end: `${year}-12-12` };
  if (season === "spring") return { start: `${year}-01-25`, end: `${year}-05-15` };
  return { start: `${year}-06-01`, end: `${year}-08-01` };
}

// { term, label, start, end, holidays: [{ date, name }], holidaysChecked, source }
async function getTerm() {
  const term = sections.currentTerm();
  if (cached && cached.term === term && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = (async () => {
    const known = TERMS[term] || { holidays: [], checked: false };
    let dates = {};
    let source = "schedule";
    try {
      dates = await datesFromSchedule(term);
    } catch (error) {
      console.error("Couldn't read semester dates from the class schedule:", error.message || error);
    }
    const fallback = guess(term);
    const start = dates.start || known.start || fallback.start;
    const end = dates.end || known.end || fallback.end;
    if (!dates.start || !dates.end) source = known.start && known.end ? "saved" : "guess";
    const holidays = known.holidays.flatMap((h) => daysBetween(h.date || h.from, h.to || h.date).map((date) => ({ date, name: h.name })));
    return { term, label: sections.termLabel(term), start, end, holidays, holidaysChecked: Boolean(known.checked), source };
  })();
  cached = { at: Date.now(), term, promise };
  promise.catch(() => { cached = null; });
  return promise;
}

module.exports = { getTerm, daysBetween };
