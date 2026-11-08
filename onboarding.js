// StudySync - first-login setup, study preference and weekly study goal.
// Stored in the Supabase "profiles" table (see supabase/schema.sql).
//
// New users go to the schedule screen (/setup) once: they add their classes, say
// whether they'd rather study alone or in a group, and how many hours a week they
// want to study. After that they go straight to the landing page (/landing).

const PREFERENCES = ["alone", "group"];
const DEFAULT_WEEKLY_HOURS = 6;
const MAX_WEEKLY_HOURS = 40;
const MAX_NOTES = 300;

// { onboarded, preference, weeklyHours, studyNotes } for the logged-in user.
// People who signed up before this screen existed and already have calendar items
// count as done, so they never see it.
async function getProfile(db, userId) {
  const { data, error } = await db.from("profiles").select("onboarded_at, study_preference, weekly_study_hours, study_notes").maybeSingle();
  if (error) throw error;
  const profile = {
    onboarded: Boolean(data?.onboarded_at),
    preference: data?.study_preference || null,
    weeklyHours: data?.weekly_study_hours || DEFAULT_WEEKLY_HOURS,
    studyNotes: data?.study_notes || "",
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
  if (error) throw error;
}

// Finish setup, or change the preference / weekly goal / study notes later. Send any of them.
// Returns { value } or { error }.
async function updateProfile(db, userId, input) {
  const fields = { onboarded_at: new Date().toISOString() };

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
  if (input.studyNotes !== undefined) {
    const notes = typeof input.studyNotes === "string" ? input.studyNotes.trim() : "";
    if (notes.length > MAX_NOTES) return { error: `Keep your study notes under ${MAX_NOTES} characters.` };
    fields.study_notes = notes;
  }
  if (Object.keys(fields).length === 1) return { error: "Nothing to save." };

  await saveProfile(db, userId, fields);
  return { value: await getProfile(db, userId) };
}

module.exports = { getProfile, updateProfile };
