// StudySync - private notes: notes only their writer can see, on the Notes page.
// Stored in private_notes (supabase/private-notes.sql); Row Level Security keeps them to their owner.
// A private note can belong to one of your groups without being shared with it. Sharing moves it
// to group_notes (lib/groups.js); making your group note private moves it back.

const groups = require("./groups");

const FIELDS = "id, group_id, title, body, created_at";

const forBrowser = (row) => ({
  id: row.id,
  groupId: row.group_id,
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
  author: "You",
  isYours: true,
  isPrivate: true,
});

// The table isn't there yet (supabase/private-notes.sql not run)
function isMissingTable(error) {
  if (!error) return false;
  return ["42P01", "PGRST205"].includes(error.code) || /private_notes/.test(error.message || "");
}
const NOT_SET_UP = { error: "Private notes aren't set up yet. Run supabase/private-notes.sql in Supabase." };

// Your private notes, newest first. null if the table isn't set up yet.
async function list(db) {
  const { data, error } = await db.from("private_notes").select(FIELDS).order("created_at", { ascending: false });
  if (isMissingTable(error)) return null;
  if (error) throw error;
  return data.map(forBrowser);
}

// Same checks as group notes. Returns { value: { title, body } } or { error }.
function check(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 120) return { error: "Give the note a title (120 characters max)." };
  if (!body) return { error: "The note is empty." };
  if (body.length > 20_000) return { error: "Notes can be 20,000 characters max." };
  return { value: { title, body } };
}

// input: { title, body, groupId? } (the group must be one of yours)
async function add(db, userId, input) {
  const checked = check(input);
  if (checked.error) return checked;
  let groupId = null;
  if (input.groupId) {
    const group = await groups.getGroup(db, String(input.groupId), userId);
    if (!group) return { error: "That group doesn't exist, or you're not in it." };
    groupId = group.id;
  }
  const { data, error } = await db.from("private_notes").insert({ ...checked.value, group_id: groupId }).select(FIELDS).single();
  if (isMissingTable(error)) return NOT_SET_UP;
  if (error) throw error;
  return { value: forBrowser(data) };
}

async function remove(db, id) {
  const { error } = await db.from("private_notes").delete().eq("id", id);
  if (error && !isMissingTable(error)) throw error;
}

// Share a private note with its group: it becomes a group note. Returns { value: group note } or { error }.
async function share(db, userId, id) {
  const { data: row, error } = await db.from("private_notes").select(FIELDS).eq("id", id).maybeSingle();
  if (isMissingTable(error)) return NOT_SET_UP;
  if (error) throw error;
  if (!row) return { error: "That note was removed. Refresh the page.", status: 404 };
  if (!row.group_id) return { error: "Pick a group for this note first." };
  const group = await groups.getGroup(db, row.group_id, userId);
  if (!group) return { error: "You're not in that group anymore." };
  const added = await groups.addNote(db, group, userId, row);
  if (added.error) return added;
  await remove(db, id);
  return { value: { ...added.value, groupId: group.id, isPrivate: false } };
}

// Make one of your group notes private: the group stops seeing it. Returns { value: private note } or { error }.
async function makePrivate(db, userId, groupId, noteId) {
  const { data: row, error } = await db.from("group_notes").select("id, user_id, title, body, created_at")
    .eq("id", noteId).eq("group_id", groupId).maybeSingle();
  if (error) throw error;
  if (!row) return { error: "That note was removed. Refresh the page.", status: 404 };
  if (row.user_id !== userId) return { error: "You can only make your own notes private.", status: 403 };
  const { data, error: addError } = await db.from("private_notes")
    .insert({ group_id: groupId, title: row.title, body: row.body, created_at: row.created_at })
    .select(FIELDS).single();
  if (isMissingTable(addError)) return NOT_SET_UP;
  if (addError) throw addError;
  await groups.removeNote(db, groupId, noteId);
  return { value: forBrowser(data) };
}

module.exports = { list, add, remove, share, makePrivate, check };
