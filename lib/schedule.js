// StudySync - saving and loading calendar items (classes, tasks, other).
// Stored in the Supabase "classes" table (see supabase/schema.sql).
//
// Every function takes `db` first: the Supabase client for the logged-in user,
// from auth.supabaseFor(req). Row Level Security means each user only ever
// sees and changes their own items.

const courses = require("./courses");
const sections = require("./sections");

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KINDS = ["class", "task", "other"]; // what can go on the calendar
const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); // "09:00"
// One-time items (tasks and "other" only): a real date, "2026-11-15". Its weekday becomes `days`.
function dayOfDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const when = new Date(Date.UTC(y, m - 1, d));
  if (when.getUTCMonth() !== m - 1 || when.getUTCDate() !== d) return null; // e.g. Feb 30
  return DAY_KEYS[(when.getUTCDay() + 6) % 7];
}

// Database row → the shape the browser expects
function fromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    name: row.name,
    courseCode: row.course_code || null, // the catalog course, e.g. "CSC 20" (classes only)
    section: row.section || null,        // e.g. "02", when picked from the class schedule
    location: row.location,
    days: row.days,
    start: row.start_time, // null for async classes
    end: row.end_time,
    date: row.on_date || null, // one-time item: its date; null = every week
  };
}

async function loadClasses(db) {
  const { data, error } = await db.from("classes").select("*").order("created_at");
  if (error) throw error;
  return data.map(fromRow);
}

// Check what the browser sent before saving it
function validateClass(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const kind = KINDS.includes(input.kind) ? input.kind : "class";
  // Room only applies to classes; the "What is it?" label only applies to Other
  const location = kind === "class" && typeof input.location === "string" ? input.location.trim() : "";
  const category = kind === "other" && typeof input.category === "string" ? input.category.trim() : "";
  const days = Array.isArray(input.days) ? DAY_KEYS.filter((d) => input.days.includes(d)) : [];
  // Asynchronous classes have no set time, and days are optional
  const isAsync = kind === "class" && input.async === true;

  if (!name || name.length > 60) return { error: "A name is required (60 characters max)." };
  if (kind === "other" && (!category || category.length > 30)) return { error: "Say what it is, e.g. Work (30 characters max)." };
  if (location.length > 60) return { error: "Room is 60 characters max." };
  if (isAsync) return { value: { kind, category, name, location, days, start_time: null, end_time: null, on_date: null } };

  // One time (tasks and "other"): a date instead of days of the week
  const once = kind !== "class" && input.repeat === "once";
  const onDay = once ? dayOfDate(input.date) : null;
  if (once && !onDay) return { error: "Pick the date it happens." };
  if (once) {
    if (!isTime(input.start) || !isTime(input.end)) return { error: "Enter a start and end time." };
    if (input.end <= input.start) return { error: "End time must be after the start time." };
    return { value: { kind, category, name, location, days: [onDay], start_time: input.start, end_time: input.end, on_date: input.date } };
  }

  if (days.length === 0) return { error: "Pick at least one day." };
  if (!isTime(input.start) || !isTime(input.end)) return { error: "Enter a start and end time." };
  if (input.end <= input.start) return { error: "End time must be after the start time." };

  return { value: { kind, category, name, location, days, start_time: input.start, end_time: input.end, on_date: null } };
}

// A class that's in the Sac State catalog gets linked to it (course_code) and named by its
// code, so "csc20" and "CSC 20-01" both become CSC 20 and match the same students.
// Classes not in the catalog keep the typed name. Work, tasks etc. are left alone.
async function linkCourse(db, row) {
  let course;
  try {
    if (row.kind !== "class") return { ...row, course_code: null };
    course = await courses.findCourse(db, row.name);
  } catch (error) {
    // Usually: the courses table isn't there yet (run supabase/schema.sql). Save it unlinked.
    console.error("Couldn't look up the course catalog (run supabase/schema.sql?):", error.message || error);
    return row;
  }
  return course ? { ...row, name: course.code, course_code: course.code } : { ...row, course_code: null };
}

// Validate and save a new item. Returns { value } on success or { error } if something's wrong.
// A class with a `section` picked from the class schedule ("02") is saved with that section's
// real days, times and room; a section that meets at two different times becomes two items,
// returned as { value: first, extra: [the rest] }.
async function addClass(db, input) {
  const picked = await sectionBlocks(input);
  if (picked) return addSectionBlocks(db, input, picked);

  const result = validateClass(input);
  if (result.error) return result;
  return insertRow(db, await linkCourse(db, result.value));
}

// The picked section's time blocks, or null (no section picked, or the schedule can't be reached:
// then the times the student sees in the form are saved as usual)
async function sectionBlocks(input) {
  const id = typeof input.section === "string" ? input.section.trim() : "";
  if (input.kind !== "class" || !/^[A-Za-z0-9]{1,10}$/.test(id)) return null;
  try {
    const code = courses.normalizeCourse(input.name);
    const { sections: list } = await sections.getSections(code);
    const section = list.find((s) => s.id === id);
    return section ? { code, section } : null;
  } catch (error) {
    console.error("Class schedule lookup failed, saving the form's times instead:", error.message || error);
    return null;
  }
}

async function addSectionBlocks(db, input, { section }) {
  const base = { ...input, kind: "class", category: "" };
  // No set time at all (fully online): an asynchronous class
  const blocks = section.blocks.length
    ? section.blocks.map((b) => ({ ...base, async: false, days: b.days, start: b.start, end: b.end, location: b.where || base.location }))
    : [{ ...base, async: true, days: [], start: null, end: null }];

  const saved = [];
  for (const block of blocks) {
    const result = validateClass(block);
    if (result.error) return saved.length ? { value: saved[0], extra: saved.slice(1) } : result;
    const inserted = await insertRow(db, { ...(await linkCourse(db, result.value)), section: section.id });
    if (inserted.error) return saved.length ? { value: saved[0], extra: saved.slice(1) } : inserted;
    saved.push(inserted.value);
  }
  return { value: saved[0], extra: saved.slice(1) };
}

// classes.on_date missing (supabase/one-time-items.sql not run yet)
const missingDateColumn = (error) => error && /on_date/.test(error.message || "");
const ONE_TIME_SETUP = "One-time items aren't set up yet. Pick days of the week for now.";

// Insert one row. If the database doesn't have the section column yet (schema.sql not re-run),
// save it without the section rather than failing.
async function insertRow(db, input) {
  // Weekly items don't send on_date, so they still save before one-time-items.sql is run
  const { on_date, ...rest } = input;
  const row = on_date ? input : rest;
  let { data, error } = await db.from("classes").insert(row).select().single();
  if (missingDateColumn(error)) return { error: ONE_TIME_SETUP };
  if (error && "section" in row && /section/.test(error.message || "")) {
    console.error("classes.section is missing (run supabase/schema.sql again); saving without it.");
    const { section, ...withoutSection } = row;
    ({ data, error } = await db.from("classes").insert(withoutSection).select().single());
  }
  if (error) throw error;
  return { value: fromRow(data) };
}

// Validate and save changes to an existing item. Returns { value }, { error }, or { notFound: true }.
async function updateClass(db, id, input) {
  const result = validateClass(input);
  if (result.error) return result;
  const row = await linkCourse(db, result.value);
  let { data, error } = await db.from("classes").update(row).eq("id", id).select().maybeSingle();
  // Database without on_date yet: a weekly item still saves (one-time ones can't exist there)
  if (missingDateColumn(error)) {
    if (row.on_date) return { error: ONE_TIME_SETUP };
    const { on_date, ...weekly } = row;
    ({ data, error } = await db.from("classes").update(weekly).eq("id", id).select().maybeSingle());
  }
  if (error) throw error;
  if (!data) return { notFound: true }; // deleted already, or not this user's
  return { value: fromRow(data) };
}

async function removeClass(db, id) {
  const { error } = await db.from("classes").delete().eq("id", id);
  if (error) throw error;
}

module.exports = { DAY_KEYS, isTime, dayOfDate, validateClass, loadClasses, addClass, updateClass, removeClass };
