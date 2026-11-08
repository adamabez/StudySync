// StudySync - study groups. Students don't create or join groups themselves:
// match_study_group() in the database (see supabase/schema.sql) puts students who
// want a group into one that meets when they're all free.
//
// Every function takes `db` first: the Supabase client for the logged-in user,
// from auth.supabaseFor(req). Students only see their own group and its members.

const { DAY_KEYS } = require("./schedule");

// Find the logged-in student a group if they want one and don't have one yet.
// Run after anything that could change the match: setup, preference, schedule changes.
async function match(db) {
  const { error } = await db.rpc("match_study_group");
  if (error) throw error;
}

// Same, but never fails the request it's attached to (e.g. saving a class)
async function matchQuietly(db) {
  try {
    await match(db);
  } catch (error) {
    console.error("Study group matching failed (run supabase/schema.sql again?):", error.message || error);
  }
}

// A group's members by name (never email): [{ userId, name, isYou }]
async function loadMembers(db, groupId, userId) {
  const { data, error } = await db.rpc("group_member_names", { gid: groupId });
  if (error) throw error;
  return data.map((m) => ({ userId: m.user_id, name: m.name, isYou: m.user_id === userId }));
}

function groupFromRow(row, members) {
  return {
    id: row.id,
    name: row.name,
    course: row.course,
    days: DAY_KEYS.filter((d) => row.days.includes(d)),
    start: row.start_time,
    end: row.end_time,
    members,
  };
}

// What the browser gets for a member: no user IDs
function memberForBrowser({ name, isYou }) {
  return { name, isYou };
}

// The student's group(s), with who's in each
async function listMyGroups(db, userId) {
  const { data, error } = await db.from("study_groups").select("*").order("created_at");
  if (error) throw error;
  return Promise.all(data.map(async (row) => {
    const members = await loadMembers(db, row.id, userId);
    return groupFromRow(row, members.map(memberForBrowser));
  }));
}


// ---------- One group's page: details + shared notes ----------

// The group with this ID, or null if it doesn't exist or the student isn't in it
// (Row Level Security hides other groups). Members include userId for matching note authors.
async function getGroup(db, groupId, userId) {
  const { data: row, error } = await db.from("study_groups").select("*").eq("id", groupId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  return groupFromRow(row, await loadMembers(db, groupId, userId));
}

// The group's notes, newest first. `group` comes from getGroup (for authors' names).
async function listNotes(db, group, userId) {
  const { data, error } = await db
    .from("group_notes")
    .select("id, user_id, title, body, created_at")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const names = new Map(group.members.map((m) => [m.userId, m.name]));
  return data.map((row) => noteForBrowser(row, names, userId));
}

function noteForBrowser(row, names, userId) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    author: names.get(row.user_id) || "A former member",
    isYours: row.user_id === userId,
  };
}

// Check and save a note. Returns { value } or { error }.
async function addNote(db, group, userId, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 120) return { error: "Give the note a title (120 characters max)." };
  if (!body) return { error: "The note is empty." };
  if (body.length > 20_000) return { error: "Notes can be 20,000 characters max." };

  const { data, error } = await db
    .from("group_notes")
    .insert({ group_id: group.id, title, body })
    .select("id, user_id, title, body, created_at")
    .single();
  if (error) throw error;
  const names = new Map(group.members.map((m) => [m.userId, m.name]));
  return { value: noteForBrowser(data, names, userId) };
}

// Delete one of your own notes (Row Level Security stops you deleting anyone else's)
async function removeNote(db, groupId, noteId) {
  const { error } = await db.from("group_notes").delete().eq("id", noteId).eq("group_id", groupId);
  if (error) throw error;
}

module.exports = {
  match, matchQuietly, listMyGroups, getGroup, memberForBrowser,
  listNotes, addNote, removeNote,
};
