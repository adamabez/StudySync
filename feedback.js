// StudySync - feedback and bug reports from the "Send feedback" link at the bottom of the dashboard.
// Stored in the Supabase "feedback" table (see supabase/schema.sql).
// Users can only add reports, not read them; the team reads them in the
// Supabase dashboard → Table Editor → feedback.

const KINDS = ["bug", "feedback", "idea"];

// Check what the browser sent before saving it
function validateFeedback(input) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const kind = KINDS.includes(input.kind) ? input.kind : "feedback";
  const message = text(input.message);
  const page = text(input.page).slice(0, 300);

  if (!message || message.length > 5_000) return { error: "Write a message (5,000 characters max)." };
  return { value: { kind, message, page } };
}

// Validate and save a report. Returns { ok } on success or { error } if something's wrong.
async function addFeedback(db, input, userAgent, email) {
  const result = validateFeedback(input);
  if (result.error) return result;
  const row = { ...result.value, email: email || "", user_agent: (userAgent || "").slice(0, 300) };
  // No .select() here: users can't read the table back, only insert into it
  const { error } = await db.from("feedback").insert(row);
  if (error) throw error;
  return { ok: true };
}

module.exports = { addFeedback };
