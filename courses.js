// StudySync - the Sac State course catalog (Supabase "courses" table, filled by
// supabase/courses.sql). Students pick their classes from it, so everyone in the same
// class gets grouped together.
//
// Every function takes `db` first: the Supabase client for the logged-in user.

// "csc20 - 01" → "CSC 20";  "EEE / CPE 64-02, 03" → "EEE 64";  "Biology 101" → "BIOLOGY 101".
// Same rules as public.normalize_course() in supabase/schema.sql: keep them in step.
function normalizeCourse(name) {
  const s = String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
  const m = s.match(/^([A-Z&]{1,8})(?: ?\/ ?[A-Z&]{1,8})* ?([0-9]{1,3}[A-Z]{0,3})(?: ?-.*| SEC.*| \(.*)?$/);
  return m ? `${m[1]} ${m[2]}` : s;
}

const forBrowser = (row) => ({ code: row.code, title: row.title, units: row.units });

// Up to `limit` courses matching what the student typed: by code ("csc 2", "csc20") or by
// title words ("data struct"). Exact code first, then codes that start with it, then titles.
async function searchCourses(db, query, limit = 12) {
  const q = String(query || "").replace(/[^A-Za-z0-9&/ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];

  // "csc2" → "CSC 2", so code searches work with or without the space
  const spaced = q.toUpperCase().replace(/^([A-Z&]+) ?(\d)/, "$1 $2");
  const codeLike = spaced.replace(/[%_]/g, "") + "%";
  const words = q.split(" ").filter((w) => w.length > 1).slice(0, 4);

  const [byCode, byTitle] = await Promise.all([
    db.from("courses").select("code, subject, number, title, units").ilike("code", codeLike).limit(60),
    words.length
      ? words.reduce((query, w) => query.ilike("title", `%${w.replace(/[%_]/g, "")}%`), db.from("courses").select("code, subject, number, title, units")).limit(30)
      : Promise.resolve({ data: [] }),
  ]);
  if (byCode.error) throw byCode.error;
  if (byTitle.error) throw byTitle.error;

  const seen = new Set();
  const rank = (row) => (row.code === spaced ? 0 : row.code.startsWith(spaced) ? 1 : 2);
  const sortCode = (a, b) => rank(a) - rank(b) || a.subject.localeCompare(b.subject) || parseInt(a.number, 10) - parseInt(b.number, 10) || a.number.localeCompare(b.number);
  return [...byCode.data.sort(sortCode), ...byTitle.data]
    .filter((row) => !seen.has(row.code) && seen.add(row.code))
    .slice(0, limit)
    .map(forBrowser);
}

// The catalog course a typed class name means, or null ("Biology 101" isn't a course code)
async function findCourse(db, name) {
  const code = normalizeCourse(name);
  if (!/^[A-Z&]+ \d/.test(code)) return null;
  const { data, error } = await db.from("courses").select("code, title, units").eq("code", code).maybeSingle();
  if (error) throw error;
  return data ? forBrowser(data) : null;
}

module.exports = { normalizeCourse, searchCourses, findCourse };
