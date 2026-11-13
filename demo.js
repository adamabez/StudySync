// StudySync - the demo: try the real app with sample data, no account needed.
//
// Opening /demo gives the visitor a demo cookie and a made-up student's week: classes,
// study groups with shared notes, course materials, a saved notebook chat and Canvas
// homework. Every /api/ request from a demo visitor is answered here instead of from
// Supabase, so the pages work exactly as they do for real students.
//
// Demo data lives only in this server's memory, separately for each visitor. Changes
// (adding a class, ticking off homework...) stick while they click around, and vanish
// after DEMO_HOURS or when the server restarts. Nothing is ever saved to Supabase.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const schedule = require("./schedule");
const courses = require("./courses");
const sections = require("./sections");
const chats = require("./chats");
const meetups = require("./meetups");
const groups = require("./groups");
const { checkMessage } = require("./namefilter");
const ai = require("./ai");
const planner = require("./public/planner");
const studyplan = require("./studyplan");

const COOKIE = "ss_demo";
const DEMO_HOURS = 3;               // a demo visitor's data is forgotten after this long without a visit
const MAX_SESSIONS = 500;           // most demos kept in memory at once (oldest dropped first)
const AI_QUESTIONS_PER_DEMO = 8;    // notebook questions one demo visitor can ask
const AI_QUESTIONS_PER_HOUR = 120;  // across every demo visitor, to protect the AI quota
const MAX_DEMO_TEXT = 50_000;       // characters per pasted source in the demo
const MAX_DEMO_ITEMS = 60;          // calendar items / sources / notes per demo

const DEMO_NAME = "Demo student";

const sessions = new Map(); // demo id → { data, lastSeen }
let aiAsks = [];            // times of recent demo AI questions (for the hourly limit)

// ---------- Cookie ----------

const isDemoId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id || "");

function readId(req) {
  const match = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match && isDemoId(match[1]) ? match[1] : null;
}

function cookie(value, maxAge) {
  const secure = (process.env.PUBLIC_URL || "").trim().startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const startCookie = (id) => cookie(id, DEMO_HOURS * 60 * 60);
const clearCookie = () => cookie("", 0);

function hasDemo(req) {
  return readId(req) !== null;
}

// ---------- Sessions ----------

function forgetOld() {
  const cutoff = Date.now() - DEMO_HOURS * 60 * 60 * 1000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value); // Map keeps insertion order
}

// A new demo: returns its id (for the cookie)
function start() {
  forgetOld();
  const id = crypto.randomUUID();
  sessions.set(id, { data: sampleData(), lastSeen: Date.now() });
  return id;
}

// This visitor's demo data. If the server restarted (or it timed out), they get a fresh
// copy of the sample week instead of an error.
function dataFor(req) {
  const id = readId(req);
  let session = sessions.get(id);
  if (!session) {
    forgetOld();
    session = { data: sampleData(), lastSeen: Date.now() };
  }
  sessions.delete(id); // re-insert so the most recently used demos are kept longest
  session.lastSeen = Date.now();
  sessions.set(id, session);
  return session.data;
}

function end(req) {
  sessions.delete(readId(req));
}

// ---------- The sample student ----------

const uuid = () => crypto.randomUUID();

// "YYYY-MM-DD" of the next given weekday ("tue"): today, unless a session ending at endTime is already over
function nextDate(dayKey, endTime = "23:59") {
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const d = new Date();
  const ahead = (keys.indexOf(dayKey) - d.getDay() + 7) % 7;
  const overToday = ahead === 0 && d.getHours() * 60 + d.getMinutes() >= Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  d.setDate(d.getDate() + (overToday ? 7 : ahead));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Weekly times the demo student is free for a session as long as the group's usual one
// (the sample classmates are always free). Same hours as the real thing: weekdays 9-9, weekends 10-6.
function demoFreeSlots(data, group) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toTime = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  const len = toMin(group.end) - toMin(group.start);
  const busy = [
    ...data.classes.filter((c) => c.start && c.end).map((c) => ({ days: c.days, start: toMin(c.start), end: toMin(c.end) })),
    ...myGroups(data).filter((g) => g.id !== group.id).map((g) => ({ days: g.days, start: toMin(g.start), end: toMin(g.end) })),
  ];
  const slots = [];
  for (const [i, day] of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].entries()) {
    const [open, close] = i < 5 ? [9 * 60, 21 * 60] : [10 * 60, 18 * 60];
    for (let s = open; s + len <= close; s += 30) {
      if (!busy.some((b) => b.days.includes(day) && b.start < s + len && s < b.end)) {
        slots.push({ day, start: toTime(s), end: toTime(s + len) });
      }
    }
  }
  return slots;
}
const ENGL_ID = "async";

// Due dates are worked out from today, so the homework always looks current
function daysFromNow(days, hour = 23, minute = 59) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const HASH_TABLES = `CSC 130 – Lecture 5: Hash Tables

A hash table stores key-value pairs and finds a value from its key in O(1) time on average. It does this with a hash function, which turns a key into an index in an array of buckets.

Hash functions
A good hash function is fast to compute and spreads keys evenly across the buckets. For integer keys, a common choice is h(k) = k mod m, where m is the table size. Choosing m to be a prime number helps spread keys that share patterns.

Collisions
A collision happens when two different keys hash to the same index. Collisions can't be avoided completely, so every hash table needs a strategy for handling them.

Separate chaining: each bucket holds a linked list of every entry that hashed there. Lookups walk the list in that bucket.

Open addressing: all entries live in the array itself. On a collision, the table probes for another empty slot. Linear probing checks the next slot, then the one after that. Linear probing is simple but causes primary clustering, where long runs of filled slots slow down lookups. Quadratic probing and double hashing reduce clustering.

Load factor
The load factor α = n / m is the number of entries divided by the number of buckets. As α grows, collisions become more common. With separate chaining, the expected length of a chain is α. Most implementations resize the table, usually doubling it, when α passes about 0.75, then rehash every entry into the new array. Resizing costs O(n) once, but the average cost per insert stays O(1) (amortized).

Worst case
If every key collides, lookups degrade to O(n). This is rare with a good hash function, but it is why hash tables are not used when guaranteed worst-case performance is required; a balanced binary search tree gives O(log n) in every case.

Exam tip: be ready to trace insertions with linear probing by hand, and to explain why the table resizes.`;

const CONDITIONING = `PSYC 2 – Chapter 6: Learning

Learning is a relatively permanent change in behavior that comes from experience.

Classical conditioning
Ivan Pavlov discovered classical conditioning while studying digestion in dogs. A neutral stimulus (a bell) is paired repeatedly with an unconditioned stimulus (food) that naturally causes an unconditioned response (salivation). After enough pairings, the bell alone causes salivation. The bell is now a conditioned stimulus, and salivation to the bell is a conditioned response.

Extinction happens when the conditioned stimulus is presented again and again without the unconditioned stimulus, and the conditioned response fades. Spontaneous recovery is the reappearance of a weakened conditioned response after a rest period.

Operant conditioning
B. F. Skinner studied operant conditioning, where behavior is shaped by its consequences. Reinforcement makes a behavior more likely; punishment makes it less likely.

Positive reinforcement adds something pleasant (praise after studying). Negative reinforcement removes something unpleasant (the seatbelt alarm stops when you buckle up). Negative reinforcement is not the same as punishment.

Schedules of reinforcement
A fixed-ratio schedule reinforces after a set number of responses. A variable-ratio schedule reinforces after an unpredictable number of responses, like a slot machine, and produces the highest, most steady response rates. Behaviors learned on variable schedules are the most resistant to extinction.

Observational learning
Albert Bandura's Bobo doll experiment showed that children imitate aggressive behavior they watch an adult model, even without being reinforced themselves.`;

function sampleData() {
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

  const classes = [
    { id: uuid(), kind: "class", category: "", name: "CSC 130", courseCode: "CSC 130", section: null, location: "Riverside Hall 1004", days: ["mon", "wed", "fri"], start: "10:00", end: "10:50" },
    { id: uuid(), kind: "class", category: "", name: "MATH 31", courseCode: "MATH 31", section: null, location: "Brighton Hall 210", days: ["tue", "thu"], start: "12:00", end: "13:50" },
    { id: uuid(), kind: "class", category: "", name: "PSYC 2", courseCode: "PSYC 2", section: null, location: "Amador Hall 150", days: ["tue", "thu"], start: "15:00", end: "16:15" },
    { id: ENGL_ID, kind: "class", category: "", name: "ENGL 20", courseCode: "ENGL 20", section: null, location: "Online", days: [], start: null, end: null },
    { id: uuid(), kind: "other", category: "Work", name: "Library shift", courseCode: null, section: null, location: "", days: ["mon", "wed"], start: "14:00", end: "18:00" },
    { id: uuid(), kind: "other", category: "Gym", name: "Climbing gym", courseCode: null, section: null, location: "", days: ["fri"], start: "17:00", end: "18:00" },
    { id: uuid(), kind: "task", category: "", name: "Calc problem set", courseCode: null, section: null, location: "", days: ["sun"], start: "13:00", end: "14:30", date: thisSunday() },
  ];

  const csGroupId = uuid();
  const groups = [
    {
      id: csGroupId, name: "CSC 130 | Group A", course: "CSC 130", days: ["tue"], start: "17:00", end: "18:30",
      members: [{ name: DEMO_NAME, isYou: true }, { name: "Maya R.", isYou: false }, { name: "Jordan T.", isYou: false }, { name: "Priya S.", isYou: false }],
    },
    {
      id: uuid(), name: "MATH 31 | Group B", course: "MATH 31", days: ["thu"], start: "17:00", end: "18:30",
      members: [{ name: DEMO_NAME, isYou: true }, { name: "Luis M.", isYou: false }, { name: "Ava K.", isYou: false }],
    },
  ];

  const notes = {
    [csGroupId]: [
      { id: uuid(), title: "Exam 1 topics", body: "From Tuesday's review:\n• Big-O for every operation we've covered\n• Tracing linear probing by hand\n• When a hash table resizes and why\n• AVL rotations (just single + double, no proofs)\n\nBring a calculator, no notes allowed.", createdAt: iso(60 * 20), author: "Maya R.", isYours: false },
      { id: uuid(), title: "Big-O cheat sheet", body: "Array access O(1)\nLinked list search O(n)\nHash table lookup O(1) average, O(n) worst\nBalanced BST search O(log n)\nHeap insert / remove O(log n)\nMerge sort O(n log n) always", createdAt: iso(60 * 50), author: "Jordan T.", isYours: false },
    ],
  };

  const hashId = uuid();
  const sources = [
    { id: hashId, title: "Lecture 5 – Hash Tables", course: "CSC 130", type: "text", size: HASH_TABLES.length, addedAt: iso(60 * 26), text: HASH_TABLES },
    { id: uuid(), title: "Ch. 6 – Learning", course: "PSYC 2", type: "text", size: CONDITIONING.length, addedAt: iso(60 * 30), text: CONDITIONING },
  ];

  const savedChats = [{
    id: uuid(),
    title: "Summarize",
    createdAt: iso(60 * 25),
    updatedAt: iso(60 * 25),
    messages: [
      { role: "user", label: "Summarize", question: "Summarize the selected sources. Start with a short overview paragraph, then list the main points." },
      {
        role: "assistant",
        answer: "A **hash table** stores key-value pairs and can find a value from its key very quickly by turning the key into an array index with a hash function.⟦1⟧\n\n**Main points**\n- **Collisions** happen when two keys land on the same index, so every hash table needs a way to handle them.⟦2⟧\n- **Separate chaining** keeps a linked list in each bucket; **open addressing** probes for another empty slot instead. Linear probing is simple but causes primary clustering.⟦3⟧\n- The **load factor** α = n / m measures how full the table is. Tables usually double in size once α passes about 0.75.⟦4⟧\n- In the **worst case**, when every key collides, lookups slow down to O(n).⟦5⟧",
        citations: [
          { n: 1, source: "Lecture 5 – Hash Tables", page: "", quote: "A hash table stores key-value pairs and finds a value from its key in O(1) time on average. It does this with a hash function, which turns a key into an index in an array of buckets." },
          { n: 2, source: "Lecture 5 – Hash Tables", page: "", quote: "A collision happens when two different keys hash to the same index. Collisions can't be avoided completely, so every hash table needs a strategy for handling them." },
          { n: 3, source: "Lecture 5 – Hash Tables", page: "", quote: "Linear probing is simple but causes primary clustering, where long runs of filled slots slow down lookups." },
          { n: 4, source: "Lecture 5 – Hash Tables", page: "", quote: "Most implementations resize the table, usually doubling it, when α passes about 0.75, then rehash every entry into the new array." },
          { n: 5, source: "Lecture 5 – Hash Tables", page: "", quote: "If every key collides, lookups degrade to O(n)." },
        ],
      },
    ],
    sourceIds: [hashId],
  }];

  // Calendar Feed style homework: the student ticks work off themselves
  const homework = [
    { id: "demo-1", name: "Lab 3: Hash Map", course: "CSC 130", dueAt: daysFromNow(-2) },
    { id: "demo-2", name: "Problem Set 7", course: "MATH 31", dueAt: daysFromNow(1, 23, 59) },
    { id: "demo-3", name: "Reading Response 4", course: "ENGL 20", dueAt: daysFromNow(3) },
    { id: "demo-4", name: "Chapter 6 Quiz", course: "PSYC 2", dueAt: daysFromNow(5, 15, 0) },
    { id: "demo-5", name: "Lab 4: Binary Heaps", course: "CSC 130", dueAt: daysFromNow(8) },
    { id: "demo-6", name: "Problem Set 6", course: "MATH 31", dueAt: daysFromNow(-5) },
    { id: "demo-7", name: "Essay 2 Outline", course: "ENGL 20", dueAt: daysFromNow(-6) },
  ].map((a) => ({ ...a, url: null }));

  return {
    profile: { onboarded: true, preference: "group", weeklyHours: 6, studyNotes: "", sessionLength: "medium" },
    classes,
    groups,
    notes,
    meetups: {
      [csGroupId]: {
        meetup: { place: "Library 2nd floor, by the windows", setBy: "Maya R.", setAt: iso(60 * 5) },
        spots: [
          { id: uuid(), place: "Library 2nd floor, by the windows", by: "Priya S.", voters: new Set(["Priya S.", "Maya R.", "Jordan T."]) },
          { id: uuid(), place: "Student Union food court", by: "Jordan T.", voters: new Set(["Jordan T."]) },
        ],
        rsvps: [
          { sessionDate: nextDate("tue", "18:30"), name: "Maya R.", status: "going" },
          { sessionDate: nextDate("tue", "18:30"), name: "Jordan T.", status: "late" },
        ],
        moves: [],
        messages: [
          { id: uuid(), sessionDate: nextDate("tue", "18:30"), author: "Jordan T.", body: "I have a lab until 5:15 on Tuesday, so I might be a bit late", createdAt: iso(60 * 3) },
          { id: uuid(), sessionDate: nextDate("tue", "18:30"), author: "Maya R.", body: "No worries! We'll start with the practice problems", createdAt: iso(60 * 2) },
        ],
        replied: false,
      },
    },
    sources,
    chats: savedChats,
    homework,
    doneIds: new Set(["demo-6", "demo-7"]),
    canvasLinked: true,
    aiQuestions: 0,
  };
}

// ---------- Course catalog (from supabase/courses.sql, so the demo needs no login) ----------

let catalog = null;
// This week's Sunday as "2026-11-15" (the demo's one-time task)
function thisSunday() {
  const now = new Date();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - ((now.getDay() + 6) % 7) - 1));
  const pad = (n) => String(n).padStart(2, "0");
  return sunday.getFullYear() + "-" + pad(sunday.getMonth() + 1) + "-" + pad(sunday.getDate());
}

function loadCatalog() {
  if (catalog) return catalog;
  catalog = [];
  try {
    const sql = fs.readFileSync(path.join(__dirname, "supabase", "courses.sql"), "utf8");
    const row = /\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'/g;
    for (const m of sql.matchAll(row)) {
      const un = (s) => s.replace(/''/g, "'");
      catalog.push({ code: un(m[1]), subject: un(m[2]), number: un(m[3]), title: un(m[4]), units: un(m[5]) });
    }
  } catch (error) {
    console.error("Demo: couldn't read supabase/courses.sql for the class picker:", error.message);
  }
  return catalog;
}

// Same results as courses.searchCourses, from memory
function searchCatalog(query, limit = 12) {
  const q = String(query || "").replace(/[^A-Za-z0-9&/ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];
  const spaced = q.toUpperCase().replace(/^([A-Z&]+) ?(\d)/, "$1 $2");
  const words = q.toLowerCase().split(" ").filter((w) => w.length > 1).slice(0, 4);
  const all = loadCatalog();

  const rank = (row) => (row.code === spaced ? 0 : 1);
  const byCode = all
    .filter((row) => row.code.startsWith(spaced))
    .sort((a, b) => rank(a) - rank(b) || a.subject.localeCompare(b.subject) || parseInt(a.number, 10) - parseInt(b.number, 10) || a.number.localeCompare(b.number));
  const byTitle = words.length ? all.filter((row) => words.every((w) => row.title.toLowerCase().includes(w))).slice(0, 30) : [];

  const seen = new Set();
  return [...byCode, ...byTitle]
    .filter((row) => !seen.has(row.code) && seen.add(row.code))
    .slice(0, limit)
    .map(({ code, title, units }) => ({ code, title, units }));
}

// A typed class name → catalog code ("csc130" → "CSC 130"), like schedule.js does
function linkName(item) {
  if (item.kind !== "class") return { ...item, courseCode: null };
  const code = courses.normalizeCourse(item.name);
  return loadCatalog().some((c) => c.code === code) ? { ...item, name: code, courseCode: code } : { ...item, courseCode: null };
}

// ---------- Study plan and groups ----------

// The plan with this week's quick edits (✎ menu) applied, plus what editing needs
function editedDemoPlan(data) {
  const meetings = data.profile.preference === "group" ? myGroups(data) : [];
  return { plan: { ...studyplan.applyEdits(studyPlan(data), data.studyEdits), editable: true }, calendar: studyplan.planCalendar(data.classes, meetings) };
}

// Same as studyplan.getStudyPlan: in a group, its meetings count toward the goal and the
// plan is solo time for the rest, around them
function studyPlan(data) {
  const meetings = data.profile.preference === "group" ? myGroups(data) : [];
  const groupMinutes = meetings.reduce((sum, g) => sum + g.days.length * (planner.toMinutes(g.end) - planner.toMinutes(g.start)), 0);
  const weeklyGoalMinutes = data.profile.weeklyHours * 60;
  const goalMinutes = Math.max(0, weeklyGoalMinutes - groupMinutes);
  const calendar = [
    ...planner.thisWeek(data.classes),
    ...meetings.map((g) => ({ name: "Study group", kind: "other", days: g.days, start: g.start, end: g.end })),
  ];
  const plan = goalMinutes ? planner.planStudyTimes(calendar, goalMinutes, data.profile.sessionLength) : { sessions: [], found: 0 };
  return {
    source: "algorithm",
    goalMinutes,
    weeklyGoalMinutes,
    groupMinutes,
    found: plan.found,
    sessions: plan.sessions.map((s) => ({ ...s, label: planner.labelFor(s.start, s.end) })),
  };
}

// Groups only count while the student wants one and still takes that class
function myGroups(data) {
  if (data.profile.preference !== "group") return [];
  const taking = new Set(data.classes.filter((c) => c.kind === "class").map((c) => c.courseCode || courses.normalizeCourse(c.name)));
  return data.groups.filter((g) => taking.has(g.course));
}

function classGroups(data) {
  const grouped = new Set(myGroups(data).map((g) => g.course));
  const seen = new Set();
  return data.classes
    .filter((c) => c.kind === "class")
    .map((c) => c.courseCode || courses.normalizeCourse(c.name))
    .filter((key) => !seen.has(key) && seen.add(key))
    .map((key) => ({ courseKey: key, label: key, hasGroup: grouped.has(key) }));
}

// ---------- Homework ----------

function homework(data) {
  const result = { missing: [], completed: [], upcoming: [], source: "feed" };
  const nowMs = Date.now();
  for (const a of data.homework) {
    const item = { ...a, checkable: true };
    if (data.doneIds.has(a.id)) result.completed.push({ ...item, done: true, score: null, pointsPossible: null });
    else if (new Date(a.dueAt).getTime() < nowMs) result.missing.push(item);
    else result.upcoming.push(item);
  }
  const byDue = (a, b) => a.dueAt.localeCompare(b.dueAt);
  result.missing.sort(byDue);
  result.upcoming.sort(byDue);
  result.completed.sort((a, b) => byDue(b, a));
  return result;
}

// ---------- Notebook ----------

const sourceForBrowser = ({ text, ...source }) => source;
const chatSummary = (chat) => chats.summary(chat);

function aiLimitReached(data) {
  if (data.aiQuestions >= AI_QUESTIONS_PER_DEMO) {
    return "That's all the AI questions for this demo. Create a free account to keep asking about your own notes.";
  }
  const hourAgo = Date.now() - 60 * 60 * 1000;
  aiAsks = aiAsks.filter((t) => t > hourAgo);
  if (aiAsks.length >= AI_QUESTIONS_PER_HOUR) {
    return "Lots of people are trying the demo right now. Wait a few minutes and try again.";
  }
  return null;
}

// ---------- API: the same routes server.js has, answered from demo data ----------
// Returns true if it handled the request.

const NEEDS_ACCOUNT = "That needs a real account. Create one for free to save your own schedule.";

async function handleApi(req, res, url, { sendJson, readJson }) {
  const data = dataFor(req);
  const m = req.method;
  const p = url.pathname;

  // --- Account ---
  if (p.startsWith("/api/account/")) return sendJson(res, { error: "This is a demo, so there's no account to change. Create a free account to get your own." }, 403);
  if (m === "GET" && p === "/api/me") return sendJson(res, { email: DEMO_NAME, name: DEMO_NAME, demo: true });

  // --- Profile and study plan ---
  if (m === "GET" && p === "/api/profile") return sendJson(res, { ...data.profile, aiScheduling: false });
  if (m === "POST" && p === "/api/profile") {
    return readJson(req, res, 10_000, (input) => {
      if (input.preference !== undefined) {
        if (!["alone", "group"].includes(input.preference)) return sendJson(res, { error: "Pick whether you'd rather study alone or with a group." }, 400);
        data.profile.preference = input.preference;
      }
      if (input.weeklyHours !== undefined) {
        const hours = Number(input.weeklyHours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 40) return sendJson(res, { error: "Pick between 1 and 40 hours a week." }, 400);
        data.profile.weeklyHours = hours;
      }
      if (typeof input.studyNotes === "string") data.profile.studyNotes = input.studyNotes.trim().slice(0, 300);
      if (planner.SESSION_LENGTHS[input.sessionLength]) data.profile.sessionLength = input.sessionLength;
      sendJson(res, data.profile);
    });
  }
  if (m === "GET" && p === "/api/study-plan") return sendJson(res, editedDemoPlan(data).plan);
  // Quick edits to this week's solo sessions (✎ menu), kept in memory
  if (m === "GET" && p === "/api/study-edits/options") {
    const { plan, calendar } = editedDemoPlan(data);
    const options = studyplan.editOptions(calendar, plan.sessions, url.searchParams.get("key"));
    return options ? sendJson(res, options) : sendJson(res, { error: "That study session isn't in this week's plan anymore. Refresh the page." }, 404);
  }
  if (m === "POST" && p === "/api/study-edits") {
    return readJson(req, res, 2_000, (input) => {
      const { plan, calendar } = editedDemoPlan(data);
      const checked = studyplan.checkEdit(calendar, plan.sessions, plan.skipped, input);
      if (checked.error) return sendJson(res, { error: checked.error }, 400);
      const week = planner.weekStart();
      const items = data.studyEdits && data.studyEdits.week === week ? { ...data.studyEdits.items } : {};
      if (checked.value) items[input.key] = checked.value;
      else delete items[input.key];
      data.studyEdits = { week, items };
      sendJson(res, { ok: true });
    });
  }
  // "I studied" checkmarks: { "2026-11-09|13:00": { date, start, end } }
  if (p === "/api/study-log") {
    const log = (data.studyLog = data.studyLog || {});
    if (m === "GET") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      return sendJson(res, { ready: true, done: Object.values(log).filter((row) => row.date >= from && row.date <= to) });
    }
    if (m === "POST") {
      return readJson(req, res, 2_000, (input) => {
        const { date, start, end } = input || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !planner.isTime(start) || !planner.isTime(end)) {
          return sendJson(res, { error: "That study session doesn't look right." }, 400);
        }
        if (input.done) log[date + "|" + start] = { date, start, end };
        else delete log[date + "|" + start];
        sendJson(res, { date, start, end, done: Boolean(input.done) });
      });
    }
  }
  if (m === "GET" && p === "/api/study-times") {
    // Group meetings (when in a group) plus solo sessions for the rest of the weekly goal
    const meetings = data.profile.preference === "group" ? myGroups(data).map((g) => ({ type: "group", id: g.id, name: g.name, days: g.days, start: g.start, end: g.end, note: g.members.length + " members" })) : [];
    const { plan } = editedDemoPlan(data);
    return sendJson(res, [...meetings, ...plan.sessions.map((s) => ({ type: "study", name: "Study time", days: [s.day], start: s.start, end: s.end, note: s.label, key: s.key, edited: s.edited, editable: true }))]);
  }

  // --- Groups ---
  if (m === "POST" && p === "/api/groups/match") return sendJson(res, myGroups(data));
  if (m === "GET" && p === "/api/groups/classes") return sendJson(res, classGroups(data));

  // --- Meeting up (kept in memory): spots, RSVPs, and moving a week's session ---
  const meetupMatch = p.match(/^\/api\/groups\/([\w-]+)\/(meetup|spots|rsvp|slots|move|messages)(?:\/([\w-]+)(\/vote)?)?$/);
  if (meetupMatch) {
    const [, groupId, part, spotId, isVote] = meetupMatch;
    const group = myGroups(data).find((g) => g.id === groupId);
    if (!group) return sendJson(res, { error: "That group doesn't exist, or you're not in it." }, 404);
    const state = (data.meetups[groupId] = data.meetups[groupId] || { meetup: null, spots: [], rsvps: [], moves: [], messages: [], replied: false });
    const info = () => ({
      meetup: state.meetup && { ...state.meetup, setBy: state.meetup.setBy === DEMO_NAME ? "You" : state.meetup.setBy },
      spots: state.spots
        .map((x) => ({
          id: x.id, place: x.place, by: x.by === DEMO_NAME ? "You" : x.by, isYours: x.by === DEMO_NAME,
          votes: x.voters.size, votedByYou: x.voters.has(DEMO_NAME), isTheSpot: state.meetup?.place === x.place,
        }))
        .sort((a, b) => b.votes - a.votes),
      rsvps: state.rsvps.map((r) => ({ ...r, isYou: r.name === DEMO_NAME })),
      moves: state.moves.map((x) => ({ ...x, movedBy: x.movedBy === DEMO_NAME ? "You" : x.movedBy })),
    });
    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

    if (m === "GET" && part === "meetup") return sendJson(res, info());
    if (m === "POST" && part === "meetup") {
      return readJson(req, res, 2_000, (input) => {
        const place = meetups.cleanPlace(input.place);
        if (place.error) return sendJson(res, { error: place.error }, 400);
        state.meetup = { place: place.value, setBy: DEMO_NAME, setAt: new Date().toISOString() };
        sendJson(res, info());
      });
    }
    if (m === "DELETE" && part === "meetup") {
      state.meetup = null;
      return sendJson(res, info());
    }
    if (m === "POST" && part === "spots" && !spotId) {
      return readJson(req, res, 2_000, (input) => {
        const place = meetups.cleanPlace(input.place);
        if (place.error) return sendJson(res, { error: place.error }, 400);
        if (state.spots.some((x) => x.place.toLowerCase() === place.value.toLowerCase())) {
          return sendJson(res, { error: "Someone already suggested that. Vote for it instead." }, 400);
        }
        if (state.spots.length >= meetups.MAX_SPOTS) {
          return sendJson(res, { error: "That's " + meetups.MAX_SPOTS + " suggestions already. Remove one or vote for an existing spot." }, 400);
        }
        state.spots.push({ id: uuid(), place: place.value, by: DEMO_NAME, voters: new Set([DEMO_NAME]) });
        sendJson(res, info(), 201);
      });
    }
    const spot = state.spots.find((x) => x.id === spotId);
    if (m === "POST" && part === "spots" && spotId && isVote) {
      return readJson(req, res, 1_000, (input) => {
        if (!spot) return sendJson(res, { error: "That suggestion was removed." }, 400);
        input.on === false ? spot.voters.delete(DEMO_NAME) : spot.voters.add(DEMO_NAME);
        sendJson(res, info());
      });
    }
    if (m === "DELETE" && part === "spots" && spotId && !isVote) {
      state.spots = state.spots.filter((x) => !(x.id === spotId && x.by === DEMO_NAME));
      return sendJson(res, info());
    }
    if (m === "POST" && part === "rsvp") {
      return readJson(req, res, 1_000, (input) => {
        if (!isDate(input.sessionDate)) return sendJson(res, { error: "That session isn't coming up." }, 400);
        state.rsvps = state.rsvps.filter((r) => !(r.sessionDate === input.sessionDate && r.name === DEMO_NAME));
        if (input.status !== null) {
          if (!meetups.STATUSES.includes(input.status)) return sendJson(res, { error: "Pick Going, Running late or Can't make it." }, 400);
          state.rsvps.push({ sessionDate: input.sessionDate, name: DEMO_NAME, status: input.status });
        }
        sendJson(res, info());
      });
    }
    if (m === "GET" && part === "slots") return sendJson(res, demoFreeSlots(data, group));
    if (m === "POST" && part === "move") {
      return readJson(req, res, 1_000, (input) => {
        const day = isDate(input.date) && ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(input.date + "T12:00:00Z").getUTCDay()];
        const fits = demoFreeSlots(data, group).some((x) => x.day === day && x.start === input.start && x.end === input.end);
        if (!isDate(input.sessionDate) || !fits) return sendJson(res, { error: "Pick one of the suggested times." }, 400);
        state.moves = state.moves.filter((x) => x.sessionDate !== input.sessionDate);
        state.moves.push({ sessionDate: input.sessionDate, date: input.date, start: input.start, end: input.end, movedBy: DEMO_NAME });
        // The time changed, so everyone answers again (you're going, since you picked it)
        state.rsvps = state.rsvps.filter((r) => r.sessionDate !== input.sessionDate);
        state.rsvps.push({ sessionDate: input.sessionDate, name: DEMO_NAME, status: "going" });
        sendJson(res, info());
      });
    }
    if (m === "DELETE" && part === "move") {
      state.moves = state.moves.filter((x) => x.sessionDate !== url.searchParams.get("session"));
      return sendJson(res, info());
    }

    // Session chat
    const forBrowser = (x) => ({ id: x.id, body: x.body, createdAt: x.createdAt, author: x.author === DEMO_NAME ? "You" : x.author, isYours: x.author === DEMO_NAME });
    if (m === "GET" && part === "messages" && !spotId) {
      const session = url.searchParams.get("session");
      const after = Date.parse(url.searchParams.get("after") || "");
      return sendJson(res, state.messages
        .filter((x) => x.sessionDate === session && (isNaN(after) || Date.parse(x.createdAt) >= after))
        .map(forBrowser));
    }
    if (m === "POST" && part === "messages" && !spotId) {
      return readJson(req, res, 5_000, (input) => {
        const body = typeof input.body === "string" ? input.body.trim() : "";
        if (!isDate(input.sessionDate)) return sendJson(res, { error: "That session isn't coming up." }, 400);
        if (!body) return sendJson(res, { error: "Type a message first." }, 400);
        if (body.length > meetups.MAX_MESSAGE) return sendJson(res, { error: "Keep it under " + meetups.MAX_MESSAGE + " characters." }, 400);
        const problem = checkMessage(body);
        if (problem) return sendJson(res, { error: problem.error }, 400);
        if (state.messages.length >= MAX_DEMO_ITEMS) return sendJson(res, { error: "That's plenty of messages for a demo." }, 400);
        const message = { id: uuid(), sessionDate: input.sessionDate, author: DEMO_NAME, body, createdAt: new Date().toISOString() };
        state.messages.push(message);
        // The first time, a classmate answers a few seconds later, so the demo shows new messages arriving
        const mate = group.members.find((x) => !x.isYou);
        if (mate && !state.replied) {
          state.replied = true;
          setTimeout(() => state.messages.push({
            id: uuid(), sessionDate: input.sessionDate, author: mate.name, body: "Works for me 👍", createdAt: new Date().toISOString(),
          }), 4000);
        }
        sendJson(res, forBrowser(message), 201);
      });
    }
    if (m === "DELETE" && part === "messages" && spotId) {
      state.messages = state.messages.filter((x) => !(x.id === spotId && x.author === DEMO_NAME));
      return sendJson(res, { ok: true });
    }
    return sendJson(res, { error: "Not found" }, 404);
  }

  const groupMatch = p.match(/^\/api\/groups\/([\w-]+)(?:\/notes(?:\/([\w-]+))?|\/(discord))?$/);
  if (groupMatch && !["match", "classes"].includes(groupMatch[1])) {
    const [, groupId, noteId, isDiscord] = groupMatch;
    const group = myGroups(data).find((g) => g.id === groupId);
    if (!group) return sendJson(res, { error: "That group doesn't exist, or you're not in it." }, 404);
    const notes = (data.notes[groupId] = data.notes[groupId] || []);
    const isNotes = p.includes("/notes");
    const discordLinks = (data.discordLinks = data.discordLinks || {}); // by class, kept in memory like everything in the demo

    if (m === "PUT" && isDiscord && groups.DISCORD_ENABLED) { // paused for now
      return readJson(req, res, 2_000, async (input) => {
        const checked = await groups.checkDiscordInput(input);
        if (checked.error) return sendJson(res, { error: checked.error }, 400);
        discordLinks[group.course] = checked.link;
        sendJson(res, { discord: await groups.discordForBrowser(checked.link) });
      });
    }
    if (m === "GET" && !isNotes && !isDiscord) {
      const discord = groups.DISCORD_ENABLED ? await groups.discordForBrowser(discordLinks[group.course] || "") : null;
      return sendJson(res, { group: { ...group, discord, discordEnabled: groups.DISCORD_ENABLED }, notes });
    }
    if (m === "POST" && isNotes && !noteId) {
      return readJson(req, res, 50_000, (input) => {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        const body = typeof input.body === "string" ? input.body.trim() : "";
        if (!title || title.length > 120) return sendJson(res, { error: "Give the note a title (120 characters max)." }, 400);
        if (!body) return sendJson(res, { error: "The note is empty." }, 400);
        if (body.length > 20_000) return sendJson(res, { error: "Notes can be 20,000 characters max." }, 400);
        if (notes.length >= MAX_DEMO_ITEMS) return sendJson(res, { error: "That's plenty of notes for a demo." }, 400);
        const note = { id: uuid(), title, body, createdAt: new Date().toISOString(), author: DEMO_NAME, isYours: true };
        notes.unshift(note);
        sendJson(res, note, 201);
      });
    }
    if (m === "DELETE" && noteId) {
      data.notes[groupId] = notes.filter((n) => !(n.id === noteId && n.isYours));
      return sendJson(res, { ok: true });
    }
  }

  // --- Course catalog and sections ---
  if (m === "GET" && p === "/api/courses" && url.searchParams.has("subject")) return sendJson(res, courses.coursesInSubject(url.searchParams.get("subject")));
  if (m === "GET" && p === "/api/courses") return sendJson(res, searchCatalog(url.searchParams.get("q")));
  if (m === "GET" && p === "/api/courses/subjects") return sendJson(res, courses.listSubjects());
  if (m === "GET" && p === "/api/courses/sections") {
    try {
      return sendJson(res, await sections.getSections(courses.normalizeCourse(url.searchParams.get("code"))));
    } catch {
      return sendJson(res, { error: "Couldn't reach Sac State's class schedule. Enter the days and times yourself." }, 502);
    }
  }

  // (Feedback from the demo goes to the real feedback table: server.js handles it before this)

  // --- Calendar ---
  if (m === "GET" && p === "/api/classes") return sendJson(res, data.classes);
  if (m === "POST" && p === "/api/classes") {
    return readJson(req, res, 10_000, (input) => {
      if (data.classes.length >= MAX_DEMO_ITEMS) return sendJson(res, { error: "That's a full week for a demo! Remove something first." }, 400);
      const result = schedule.validateClass(input);
      if (result.error) return sendJson(res, { error: result.error }, 400);
      const v = result.value;
      const item = linkName({ id: uuid(), kind: v.kind, category: v.category, name: v.name, section: null, location: v.location, days: v.days, start: v.start_time, end: v.end_time, date: v.on_date || null });
      data.classes.push(item);
      sendJson(res, { ...item, extra: [] }, 201);
    });
  }
  const classMatch = p.match(/^\/api\/classes\/([\w-]+)$/);
  if (m === "PUT" && classMatch) {
    return readJson(req, res, 10_000, (input) => {
      const index = data.classes.findIndex((c) => c.id === classMatch[1]);
      if (index === -1) return sendJson(res, { error: "That item was already removed. Refresh the page." }, 404);
      const result = schedule.validateClass(input);
      if (result.error) return sendJson(res, { error: result.error }, 400);
      const v = result.value;
      data.classes[index] = linkName({ ...data.classes[index], kind: v.kind, category: v.category, name: v.name, location: v.location, days: v.days, start: v.start_time, end: v.end_time, date: v.on_date || null });
      sendJson(res, data.classes[index]);
    });
  }
  if (m === "DELETE" && classMatch) {
    data.classes = data.classes.filter((c) => c.id !== classMatch[1]);
    return sendJson(res, { ok: true });
  }

  // --- Notebook: materials ---
  if (m === "GET" && p === "/api/sources") return sendJson(res, data.sources.map(sourceForBrowser));
  if (m === "POST" && p === "/api/sources") {
    return readJson(req, res, 15_000_000, (input) => {
      if (input.type === "pdf") return sendJson(res, { error: "PDF uploads need a free account. In the demo, use Paste text, or open a .txt / .md file." }, 400);
      if (input.type !== "text") return sendJson(res, { error: "Unknown material type." }, 400);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const course = typeof input.course === "string" ? input.course.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!title || title.length > 120) return sendJson(res, { error: "Give the material a title (120 characters max)." }, 400);
      if (course.length > 60) return sendJson(res, { error: "Course name is 60 characters max." }, 400);
      if (!text) return sendJson(res, { error: "The material is empty." }, 400);
      if (text.length > MAX_DEMO_TEXT) return sendJson(res, { error: "The demo takes up to 50,000 characters per source. Create a free account for bigger materials." }, 400);
      if (data.sources.length >= MAX_DEMO_ITEMS) return sendJson(res, { error: "That's plenty of materials for a demo." }, 400);
      const source = { id: uuid(), title, course, type: "text", size: text.length, addedAt: new Date().toISOString(), text };
      data.sources.push(source);
      sendJson(res, sourceForBrowser(source), 201);
    });
  }
  const sourceMatch = p.match(/^\/api\/sources\/([\w-]+)$/);
  if (m === "GET" && sourceMatch) {
    const source = data.sources.find((s) => s.id === sourceMatch[1]);
    if (!source) return sendJson(res, { error: "That material was removed. Refresh the page." }, 404);
    return sendJson(res, { ...sourceForBrowser(source), text: source.text });
  }
  if (m === "DELETE" && sourceMatch) {
    data.sources = data.sources.filter((s) => s.id !== sourceMatch[1]);
    return sendJson(res, { ok: true });
  }

  // --- Notebook: chats ---
  if (m === "GET" && p === "/api/chats") {
    return sendJson(res, [...data.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(chatSummary));
  }
  const chatMatch = p.match(/^\/api\/chats\/([\w-]+)$/);
  if (m === "GET" && chatMatch) {
    const chat = data.chats.find((c) => c.id === chatMatch[1]);
    return chat ? sendJson(res, chat) : sendJson(res, { error: "Chat not found" }, 404);
  }
  if (m === "DELETE" && chatMatch) {
    data.chats = data.chats.filter((c) => c.id !== chatMatch[1]);
    return sendJson(res, { ok: true });
  }

  // --- Notebook: asking the AI (real answers, about the demo's materials) ---
  if (m === "GET" && p === "/api/notebook/status") {
    return sendJson(res, { aiEnabled: ai.aiEnabled(), freeTier: ai.aiEnabled() && ai.providerInfo().freeTier });
  }
  if (m === "POST" && p === "/api/notebook/ask") {
    return readJson(req, res, 2_000_000, async (input) => {
      if (!ai.aiEnabled()) return sendJson(res, { error: "AI answers are off on this server right now." }, 503);
      const limit = aiLimitReached(data);
      if (limit) return sendJson(res, { error: limit }, 429);

      const question = typeof input.question === "string" ? input.question.trim() : "";
      const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 200) : question;
      const ids = Array.isArray(input.sourceIds) ? input.sourceIds : [];
      if (!question || question.length > 5_000) return sendJson(res, { error: "Type a question (5,000 characters max)." }, 400);

      const chat = typeof input.chatId === "string" ? data.chats.find((c) => c.id === input.chatId) : null;
      if (input.chatId && !chat) return sendJson(res, { error: "That chat was deleted. Start a new chat." }, 404);

      const selected = data.sources.filter((s) => ids.includes(s.id));
      if (selected.length === 0) return sendJson(res, { error: "Tick at least one source to ask about." }, 400);

      data.aiQuestions++;
      aiAsks.push(Date.now());
      let result;
      try {
        result = await ai.askNotebook({
          sources: selected.map((s) => ({ source: sourceForBrowser(s), content: s.text })),
          history: chat ? chats.historyFor(chat) : [],
          question,
        });
      } catch (error) {
        console.error("Demo notebook question failed:", error.message || error);
        data.aiQuestions--; // a failed try doesn't use up their questions
        return sendJson(res, { error: ai.explainError(error) }, 502);
      }
      if (result.error) return sendJson(res, { error: result.error }, 422);

      const now = new Date().toISOString();
      const exchange = [{ role: "user", label, question }, { role: "assistant", answer: result.answer, citations: result.citations }];
      let saved = chat;
      if (saved) {
        saved.messages.push(...exchange);
        saved.updatedAt = now;
      } else {
        saved = { id: uuid(), title: chats.makeTitle(label), createdAt: now, updatedAt: now, messages: exchange };
        data.chats.push(saved);
      }
      sendJson(res, { ...result, chat: chatSummary(saved) });
    });
  }

  // --- Canvas (sample homework, Calendar Feed style) ---
  if (m === "GET" && p === "/api/canvas/status") {
    return sendJson(res, data.canvasLinked ? { connected: true, canvasUrl: null, mode: "feed" } : { connected: false });
  }
  if (m === "GET" && p === "/api/canvas/assignments") {
    if (!data.canvasLinked) return sendJson(res, { error: "Canvas isn't linked." }, 409);
    return sendJson(res, homework(data));
  }
  if (m === "POST" && p === "/api/canvas/done") {
    return readJson(req, res, 2_000, (input) => {
      if (!data.homework.some((a) => a.id === input.id)) return sendJson(res, { error: "That assignment isn't in your homework anymore. Refresh." }, 404);
      if (input.done) data.doneIds.add(input.id);
      else data.doneIds.delete(input.id);
      sendJson(res, { id: input.id, done: Boolean(input.done) });
    });
  }
  if (p === "/api/canvas/connect" && m === "DELETE") {
    data.canvasLinked = false;
    return sendJson(res, { ok: true });
  }
  if (p === "/api/canvas/connect" && m === "POST") {
    return sendJson(res, { error: "Linking your real Canvas needs a free account. In the demo, refresh the page to bring the sample homework back." }, 403);
  }

  return sendJson(res, { error: NEEDS_ACCOUNT }, 404);
}

// ---------- The banner on every demo page ----------

const BANNER = `
  <div class="demo-banner" role="region" aria-label="Demo">
    <span class="demo-banner-text"><strong>You're trying a demo.</strong> This is sample data, so play around: nothing you change is saved. StudySync is still in development, so tell us what you'd like it to do!</span>
    <span class="demo-banner-actions">
      <a href="/signup" class="demo-banner-cta">Create a free account</a>
      <a href="/logout" class="demo-banner-exit">Exit demo</a>
    </span>
  </div>`;

// Adds the banner (and its styles) to a page's HTML
function withBanner(html) {
  return html
    .replace("</head>", `  <link rel="stylesheet" href="/public/demo.css">\n</head>`)
    .replace(/<body([^>]*)>/, `<body$1 class="is-demo">${BANNER}`);
}

// The login page's live preview shows a page inside a frame: no banner, pop-ups or scrollbars.
// The login page scrolls it from outside, so it doesn't need to be clickable.
// The login page's live demo box: visitors scroll and click around the real demo inside it.
// Links that leave the demo (sign up, log in, log out, exit) open in the whole window instead.
const PREVIEW_STYLE = `
  <style>
    html { scrollbar-width: thin; }
    .ai-notice, .ai-disclaimer, .theme-toggle, .dash-footer, .fb-fab { display: none !important; }
    body { align-items: flex-start !important; } /* page at the top, not centered */
  </style>
  <script>
    document.addEventListener("click", (event) => {
      const link = event.target.closest && event.target.closest("a[href]");
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href, location.href);
      // Off-site, the login page itself ("/"), or anything about accounts
      const leaves = url.origin !== location.origin || url.pathname === "/" ||
        /^\\/(signup|login|logout|forgot|reset-password|account)\\b/.test(url.pathname);
      if (leaves) { event.preventDefault(); window.top.location.href = url.href; }
    }, true);
  </script>`;

function forPreview(html) {
  return html.replace("</head>", `${PREVIEW_STYLE}\n</head>`);
}

module.exports = { hasDemo, start, end, startCookie, clearCookie, handleApi, withBanner, forPreview };
