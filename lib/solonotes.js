// StudySync - solo notes: a student's own private notes on the Notes page.
// Stored in solo_notes (supabase/solo-notes.sql); Row Level Security keeps them to their owner.

const FIELDS = "id, title, body, created_at";

const forBrowser = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
  author: "You",
  isYours: true,
});

// The table isn't there yet (supabase/solo-notes.sql not run)
function isMissingTable(error) {
  if (!error) return false;
  return ["42P01", "PGRST205"].includes(error.code) || /solo_notes/.test(error.message || "");
}

// Your notes, newest first. null if the table isn't set up yet.
async function list(db) {
  const { data, error } = await db.from("solo_notes").select(FIELDS).order("created_at", { ascending: false });
  if (isMissingTable(error)) return null;
  if (error) throw error;
  return data.map(forBrowser);
}

// Same checks as group notes. Returns { value } or { error }.
function check(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 120) return { error: "Give the note a title (120 characters max)." };
  if (!body) return { error: "The note is empty." };
  if (body.length > 20_000) return { error: "Notes can be 20,000 characters max." };
  return { value: { title, body } };
}

async function add(db, input) {
  const checked = check(input);
  if (checked.error) return checked;
  const { data, error } = await db.from("solo_notes").insert(checked.value).select(FIELDS).single();
  if (isMissingTable(error)) return { error: "Solo notes aren't set up yet. Run supabase/solo-notes.sql in Supabase." };
  if (error) throw error;
  return { value: forBrowser(data) };
}

async function remove(db, id) {
  const { error } = await db.from("solo_notes").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

module.exports = { list, add, remove, check };
