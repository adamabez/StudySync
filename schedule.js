// StudySync - saving and loading calendar items (classes, tasks, other).
// Stored in the Supabase "classes" table (see supabase/schema.sql).
//
// Every function takes `db` first: the Supabase client for the logged-in user,
// from auth.supabaseFor(req). Row Level Security means each user only ever
// sees and changes their own items.

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KINDS = ["class", "task", "other"]; // what can go on the calendar
const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); // "09:00"

// Database row → the shape the browser expects
function fromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    name: row.name,
    location: row.location,
    days: row.days,
    start: row.start_time, // null for async classes
    end: row.end_time,
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
  if (isAsync) return { value: { kind, category, name, location, days, start_time: null, end_time: null } };

  if (days.length === 0) return { error: "Pick at least one day." };
  if (!isTime(input.start) || !isTime(input.end)) return { error: "Enter a start and end time." };
  if (input.end <= input.start) return { error: "End time must be after the start time." };

  return { value: { kind, category, name, location, days, start_time: input.start, end_time: input.end } };
}

// Validate and save a new item. Returns { value } on success or { error } if something's wrong.
async function addClass(db, input) {
  const result = validateClass(input);
  if (result.error) return result;
  const { data, error } = await db.from("classes").insert(result.value).select().single();
  if (error) throw error;
  return { value: fromRow(data) };
}

// Validate and save changes to an existing item. Returns { value }, { error }, or { notFound: true }.
async function updateClass(db, id, input) {
  const result = validateClass(input);
  if (result.error) return result;
  const { data, error } = await db.from("classes").update(result.value).eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (!data) return { notFound: true }; // deleted already, or not this user's
  return { value: fromRow(data) };
}

async function removeClass(db, id) {
  const { error } = await db.from("classes").delete().eq("id", id);
  if (error) throw error;
}

module.exports = { DAY_KEYS, isTime, loadClasses, addClass, updateClass, removeClass };
