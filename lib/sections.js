// StudySync - class sections from Sac State's public class schedule
// (https://www.csus.edu/class-schedule/), so picking "CSC 20, section 02" fills in the days,
// times and room by itself.
//
// The schedule page loads its data from classschedule.webhost.csus.edu. That isn't an
// official, documented feed, so everything here fails softly: if it's down or changes,
// students just type their times in like before.
//
// To go easy on Sac State's server, a subject is fetched only when a student picks a class
// in it, then kept in memory for 6 hours.
//
// Term: set SECTIONS_TERM in .env (e.g. spring-2027) when a new semester's schedule is out;
// otherwise it's worked out from today's date (Aug–Dec fall, Jan–May spring, Jun–Jul summer).

const API = "https://classschedule.webhost.csus.edu/api/cs/";
const CACHE_MS = 6 * 60 * 60 * 1000;
const HEADERS = { "User-Agent": "StudySync (student project) class picker" };
const DAY_LETTERS = { M: "mon", T: "tue", W: "wed", R: "thu", F: "fri", S: "sat", U: "sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function currentTerm(now = new Date()) {
  const fromEnv = (process.env.SECTIONS_TERM || "").trim().toLowerCase();
  if (/^(spring|summer|fall|winter)-\d{4}$/.test(fromEnv)) return fromEnv;
  const month = now.getMonth() + 1;
  const season = month >= 8 ? "fall" : month >= 6 ? "summer" : "spring";
  return `${season}-${now.getFullYear()}`;
}

const termLabel = (term) => term.replace(/^(\w)(\w*)-(\d{4})$/, (m, a, b, y) => a.toUpperCase() + b + " " + y);

// "0100PM" → "13:00"
function to24h(t) {
  const m = String(t || "").match(/^(\d{1,2})(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return String(h).padStart(2, "0") + ":" + m[2];
}

// "MWF" → ["mon", "wed", "fri"]
const toDays = (letters) => [...String(letters || "").toUpperCase()].map((c) => DAY_LETTERS[c]).filter(Boolean);

// "Faroughi,Gita" → "Gita Faroughi"
const instructorName = (s) => String(s || "").split(",").map((p) => p.trim()).filter(Boolean).reverse().join(" ");

const where = (m) => {
  const building = String(m.building || "").trim(), room = String(m.room || "").trim();
  if (!building || /^(WEB|ONLINE|TBA)$/i.test(building) || /^(ONLINE|TBA)$/i.test(room)) return "";
  return (building + " " + room).trim();
};

const cache = new Map(); // "fall-2026/CSC" → { at, promise }

async function fetchSubject(term, subject) {
  const key = term + "/" + subject;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = (async () => {
    const response = await fetch(API + encodeURIComponent(term) + "/" + encodeURIComponent(subject), {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`class schedule answered ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  })();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key)); // don't keep a failure for 6 hours
  return promise;
}

// One section's meetings → time blocks: meetings at the same time are merged into one block
// with all their days ("M" 10:00 + "W" 10:00 → Mon, Wed 10:00). Meetings with no set time
// (the online part of a hybrid class) are left out; a section with none at all is "online".
function toSection(meetings) {
  const first = meetings[0];
  const blocks = new Map();
  for (const m of meetings) {
    const start = to24h(m.start_time), end = to24h(m.end_time), days = toDays(m.days);
    if (!start || !end || end <= start || !days.length) continue;
    const key = start + "-" + end;
    const block = blocks.get(key) || { days: [], start, end, where: where(m) };
    for (const d of days) if (!block.days.includes(d)) block.days.push(d);
    if (!block.where) block.where = where(m);
    blocks.set(key, block);
  }
  const list = [...blocks.values()]
    .map((b) => ({ ...b, days: DAY_ORDER.filter((d) => b.days.includes(d)) }))
    .sort((a, b) => DAY_ORDER.indexOf(a.days[0]) - DAY_ORDER.indexOf(b.days[0]) || a.start.localeCompare(b.start));
  return {
    id: String(first.class_section || "").slice(0, 10),
    component: String(first.component || "").slice(0, 40),
    instructor: instructorName(first.instructor).slice(0, 80),
    mode: String(first.instruction_mode_ldesc || "").slice(0, 40),
    seats: Number(first.seats_total) || null,
    blocks: list,
  };
}

// Sections of one course this term, e.g. getSections("CSC 20").
// Returns { term, termLabel, sections: [{ id, component, instructor, mode, seats, blocks }] }.
// Throws if the class schedule can't be reached.
async function getSections(code) {
  const m = String(code || "").match(/^([A-Z&]{1,8}) (\d{1,3}[A-Z]{0,3})$/);
  const term = currentTerm();
  if (!m) return { term, termLabel: termLabel(term), sections: [] };
  const [, subject, number] = m;
  const courses = await fetchSubject(term, subject);
  const course = courses.find((c) => String(c.catalog_number).trim().toUpperCase() === number);
  const bySection = new Map();
  for (const s of course ? course.sections || [] : []) {
    const id = String(s.class_section || "");
    if (!id) continue;
    if (!bySection.has(id)) bySection.set(id, []);
    bySection.get(id).push(s);
  }
  const sections = [...bySection.values()].map(toSection).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { term, termLabel: termLabel(term), sections };
}

module.exports = { currentTerm, termLabel, fetchSubject, getSections, to24h, toDays, toSection };
