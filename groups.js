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

// The student's group(s), with who's in each
async function listMyGroups(db, userId) {
  const [groupsResult, membersResult] = await Promise.all([
    db.from("study_groups").select("*").order("created_at"),
    db.from("group_members").select("group_id, user_id, email, joined_at").order("joined_at"),
  ]);
  if (groupsResult.error) throw groupsResult.error;
  if (membersResult.error) throw membersResult.error;

  return groupsResult.data.map((row) => ({
    id: row.id,
    name: row.name,
    course: row.course,
    days: DAY_KEYS.filter((d) => row.days.includes(d)),
    start: row.start_time,
    end: row.end_time,
    members: membersResult.data
      .filter((m) => m.group_id === row.id)
      .map((m) => ({ email: m.email, isYou: m.user_id === userId })),
  }));
}

module.exports = { match, matchQuietly, listMyGroups };
