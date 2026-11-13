// StudySync - "I studied" checkmarks on solo study sessions and study group meetings
// (study plan page and dashboard).
// Stored in the Supabase "study_log" table (supabase/schema.sql): one row per session done,
// by date, so checking this Monday's session doesn't tick next Monday's.
//
// Every function takes `db` first: the Supabase client for the logged-in user.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "relation does not exist" (42P01) / PostgREST "not in the schema cache" (PGRST205):
// supabase/study-log.sql hasn't been run yet
function isMissingTable(error) {
  return error && (error.code === "42P01" || error.code === "PGRST205" || /study_log/.test(error.message || ""));
}

// Sessions marked done between two dates (inclusive): { ready, done: [{ date, start, end }] }
// ready is false when the table isn't set up yet (the page then hides the checkmarks).
async function listDone(db, from, to) {
  if (!DATE.test(from || "") || !DATE.test(to || "")) return { error: "Pick a date range." };
  const { data, error } = await db
    .from("study_log")
    .select("date, start_time, end_time")
    .gte("date", from)
    .lte("date", to);
  if (isMissingTable(error)) return { value: { ready: false, done: [] } };
  if (error) throw error;
  return { value: { ready: true, done: data.map((row) => ({ date: row.date, start: row.start_time, end: row.end_time })) } };
}

// Tick or untick one session: { date, start, end, done, kind?, groupId? }. Returns { value } or { error }.
async function setDone(db, userId, input) {
  const { date, start, end } = input || {};
  if (!DATE.test(date || "") || !TIME.test(start || "") || !TIME.test(end || "") || end <= start) {
    return { error: "That study session doesn't look right." };
  }
  const result = input.done
    ? await db.from("study_log").upsert({
      user_id: userId, date, start_time: start, end_time: end,
      kind: input.kind === "group" ? "group" : "solo",
      group_id: input.kind === "group" && UUID.test(input.groupId || "") ? input.groupId : null,
    }, { onConflict: "user_id,date,start_time" })
    : await db.from("study_log").delete().eq("date", date).eq("start_time", start);
  if (isMissingTable(result.error)) return { error: "Checking off study sessions isn't set up yet.", status: 503 };
  if (result.error) throw result.error;
  return { value: { date, start, end, done: Boolean(input.done) } };
}

module.exports = { listDone, setDone };
