// StudySync - first-login setup, study preference and weekly study goal.
// Stored in the Supabase "profiles" table (see supabase/schema.sql).
//
// New users go to the schedule screen (/setup) once: they add their classes, say
// whether they'd rather study alone or in a group, and how many hours a week they
// want to study. After that they go straight to the landing page (/landing).

const { checkName } = require("./namefilter");

const PREFERENCES = ["alone", "group"];
const DEFAULT_WEEKLY_HOURS = 6;
const MAX_WEEKLY_HOURS = 40;
const MAX_NOTES = 300;
const MAX_NAME = 40;

// A name to show classmates: 1-40 characters, spaces tidied, nothing inappropriate (namefilter.js).
// Returns { value } or { error, code } (code goes in the sign-up page's ?error=).
function cleanName(input) {
  const name = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: "Enter your name.", code: "name" };
  if (name.length > MAX_NAME) return { error: `Keep your name under ${MAX_NAME} characters.`, code: "name" };
  const problem = checkName(name);
  if (problem) return problem;

  // A real first and last name, not a username: two or more words, and the first and last
  // are full words, not initials ("Mary J. Watson" and "Ana de la Cruz" are fine)
  const words = name.split(" ");
  // (In Chinese, Japanese and Korean one character is a whole name, e.g. 李)
  const fullWord = (word) => word.replace(/[.'’-]/g, "").length >= 2 ||
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word);
  if (words.length < 2 || !fullWord(words[0]) || !fullWord(words[words.length - 1])) {
    return { error: "Enter your first and last name, e.g. Alex Kim.", code: "name-full" };
  }
  return { value: tidyCapitals(name) };
}

// "alex kim" / "ALEX KIM" → "Alex Kim". Names typed with their own capitals
// ("McDonald", "de la Cruz") are left exactly as typed.
function tidyCapitals(name) {
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, before, letter) => before + letter.toUpperCase());
}

// The name classmates see: the one set in StudySync, else the one from sign-up
// How long study sessions are (public/planner.js SESSION_LENGTHS)
const SESSION_LENGTHS = ["short", "medium", "long"];
const DEFAULT_SESSION_LENGTH = "medium";
const PROFILE_COLUMNS = "onboarded_at, study_preference, weekly_study_hours, study_notes, display_name";

function displayName(profile, user) {
  return profile?.displayName || (user?.user_metadata?.name || "").trim().slice(0, MAX_NAME) || "";
}

// { onboarded, preference, weeklyHours, studyNotes, displayName, sessionLength } for the logged-in user.
// People who signed up before this screen existed and already have calendar items
// count as done, so they never see it.
async function getProfile(db, userId) {
  let { data, error } = await db.from("profiles").select(PROFILE_COLUMNS + ", study_session_length").maybeSingle();
  // Database without the session length column yet (supabase/session-length.sql): carry on without it
  if (error && isMissingColumn(error)) ({ data, error } = await db.from("profiles").select(PROFILE_COLUMNS).maybeSingle());
  if (error) throw error;
  const profile = {
    onboarded: Boolean(data?.onboarded_at),
    preference: data?.study_preference || null,
    weeklyHours: data?.weekly_study_hours || DEFAULT_WEEKLY_HOURS,
    studyNotes: data?.study_notes || "",
    displayName: data?.display_name || "",
    sessionLength: SESSION_LENGTHS.includes(data?.study_session_length) ? data.study_session_length : DEFAULT_SESSION_LENGTH,
  };
  if (profile.onboarded) return profile;

  const { count, error: countError } = await db.from("classes").select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if (count > 0) {
    await saveProfile(db, userId, { onboarded_at: new Date().toISOString() });
    profile.onboarded = true;
  }
  return profile;
}

async function saveProfile(db, userId, fields) {
  const { error } = await db.from("profiles").upsert({ user_id: userId, ...fields }, { onConflict: "user_id" });
  if (error && "study_session_length" in fields && isMissingColumn(error)) {
    const missing = new Error("Session length needs supabase/session-length.sql run in Supabase first.");
    missing.code = "SESSION_LENGTH_COLUMN";
    throw missing;
  }
  if (error) throw error;
}

// Postgres "column does not exist" (42703) or PostgREST's "not in the schema cache" (PGRST204)
function isMissingColumn(error) {
  return error.code === "42703" || error.code === "PGRST204" || /study_session_length/.test(error.message || "");
}

// Finish setup, or change the preference / weekly goal / study notes / name later. Send any of them.
// Returns { value } or { error }.
async function updateProfile(db, userId, input) {
  const fields = {};

  if (input.displayName !== undefined) {
    const name = cleanName(input.displayName);
    if (name.error) return name;
    fields.display_name = name.value;
  }

  if (input.preference !== undefined) {
    if (!PREFERENCES.includes(input.preference)) return { error: "Pick whether you'd rather study alone or with a group." };
    fields.study_preference = input.preference;
  }
  if (input.weeklyHours !== undefined) {
    const hours = Number(input.weeklyHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_WEEKLY_HOURS) {
      return { error: `Pick between 1 and ${MAX_WEEKLY_HOURS} hours a week.` };
    }
    fields.weekly_study_hours = hours;
  }
  if (input.sessionLength !== undefined) {
    if (!SESSION_LENGTHS.includes(input.sessionLength)) return { error: "Pick short, medium or long study sessions." };
    fields.study_session_length = input.sessionLength;
  }
  if (input.studyNotes !== undefined) {
    const notes = typeof input.studyNotes === "string" ? input.studyNotes.trim() : "";
    if (notes.length > MAX_NOTES) return { error: `Keep your study notes under ${MAX_NOTES} characters.` };
    fields.study_notes = notes;
  }
  // { skip: true }: "Skip for now" on the setup screen. Just marks setup as done, so they go
  // straight to the dashboard from now on; they can add classes and preferences later.
  if (Object.keys(fields).length === 0 && input.skip !== true) return { error: "Nothing to save." };
  // Anything but a name change also finishes first-login setup
  if (input.skip === true || Object.keys(fields).some((key) => key !== "display_name")) {
    fields.onboarded_at = new Date().toISOString();
  }

  await saveProfile(db, userId, fields);
  return { value: await getProfile(db, userId) };
}

module.exports = { getProfile, updateProfile, cleanName, displayName };
