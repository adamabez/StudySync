// StudySync - builds supabase/courses.sql: every course in Sac State's public catalog
// (https://catalog.csus.edu/courses-a-z/), so students pick their classes from a list.
//
// Run:  node scripts/import-courses.js
// Then: Supabase → SQL Editor → paste supabase/courses.sql → Run (safe to run again; it
//       updates titles and adds new courses, and never deletes any).
//
// Re-run each semester or two to pick up new courses. It fetches one department page at a
// time with a short pause, to go easy on the catalog site.

const fs = require("fs");
const path = require("path");

const BASE = "https://catalog.csus.edu";
const PAUSE_MS = 300;
const OUT = path.join(__dirname, "..", "supabase", "courses.sql");
const HEADERS = { "User-Agent": "StudySync class list import (student project)" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function decode(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= tries) throw error;
      await sleep(2000 * attempt); // network blip: wait and try again
    }
  }
}

// "CSC 20. Programming Concepts and Methodology II." → { subject, number, title }
function parseTitle(text) {
  const m = text.match(/^([A-Z][A-Z&]{0,7}(?: [A-Z]{1,4})?)\s+(\d{1,3}[A-Z]{0,3}(?:-[A-Z0-9]+)?)\.\s+(.+?)\.?$/);
  if (!m) return null;
  return { subject: m[1], number: m[2], title: m[3].trim() };
}

const sql = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Sort CSC 2 before CSC 10 before CSC 10A
function compareCourses(a, b) {
  if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
  const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
  return na - nb || a.number.localeCompare(b.number);
}

(async () => {
  const index = await get(BASE + "/courses-a-z/");
  const pages = [...new Set([...index.matchAll(/href="(\/courses-a-z\/[a-z0-9_-]+\/)"/g)].map((m) => m[1]))];
  console.log(`Found ${pages.length} department pages`);

  const courses = new Map(); // "CSC 20" → course
  const skipped = [];
  for (const [i, page] of pages.entries()) {
    let html;
    try {
      html = await get(BASE + page);
    } catch (error) {
      console.log(`  ! ${page}: ${error.message}`);
      continue;
    }
    let found = 0;
    // One courseblock per course: title, units, and maybe "Cross Listed: CPE 64" in the description
    for (const block of html.split(/<div class="courseblock">/).slice(1)) {
      const m = block.match(/<span class="title">([\s\S]*?)<\/span>(?:\s*<span class="credits">([\s\S]*?)<\/span>)?/);
      if (!m) continue;
      const titleText = decode(m[1]);
      const course = parseTitle(titleText);
      if (!course) { skipped.push(titleText); continue; }
      const code = `${course.subject} ${course.number}`;
      const cross = block.match(/Cross ?-?listed:([\s\S]*?)<\/p>/i);
      // The catalog puts a non-breaking space in "CPE 64"; treat it like a normal space
      const crossText = cross ? cross[1].replace(/ |&#160;|&nbsp;/g, " ") : "";
      const crossListed = [...crossText.matchAll(/title="([A-Z][A-Z&]{0,7}(?: [A-Z]{1,4})? \d{1,3}[A-Z]{0,3})"/g)].map((x) => x[1]);
      if (!courses.has(code)) {
        courses.set(code, { code, ...course, units: m[2] ? decode(m[2]) : "", crossListed });
        found++;
      }
    }
    process.stdout.write(`\r  ${i + 1}/${pages.length} ${page.padEnd(28)} ${found} courses`);
    await sleep(PAUSE_MS);
  }
  console.log();

  const list = [...courses.values()].sort(compareCourses);

  // Cross-listed courses (EEE 64 = CPE 64) share a match_key, so their students are
  // grouped together: the first code alphabetically among everything linked to it.
  const parent = new Map(list.map((c) => [c.code, c.code]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const c of list) {
    for (const other of c.crossListed) {
      if (!parent.has(other)) continue; // links to a course we don't have
      const a = find(c.code), b = find(other);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  const crossCount = list.filter((c) => find(c.code) !== c.code).length;

  const rows = list.map((c) => `(${sql(c.code)}, ${sql(c.subject)}, ${sql(c.number)}, ${sql(c.title.slice(0, 200))}, ${sql(c.units.slice(0, 30))}, ${sql(find(c.code))})`);

  const header = `-- Sac State course catalog for StudySync's class picker: ${list.length} courses.
-- Made by scripts/import-courses.js from https://catalog.csus.edu/courses-a-z/ on ${new Date().toISOString().slice(0, 10)}.
-- Run supabase/schema.sql first (it creates the courses table), then run this file in
-- Supabase → SQL Editor. Safe to run again: it updates titles and adds new courses.
`;
  // Batches of 500 so each insert stays a reasonable size
  const batches = [];
  for (let i = 0; i < rows.length; i += 500) {
    batches.push(`insert into public.courses (code, subject, number, title, units, match_key) values\n${rows.slice(i, i + 500).join(",\n")}\non conflict (code) do update set subject = excluded.subject, number = excluded.number, title = excluded.title, units = excluded.units, match_key = excluded.match_key;`);
  }
  // Classes students typed before the catalog was loaded: link them to their course now,
  // and switch existing groups to course keys (same as the end of schema.sql)
  const backfill = `
-- Link classes added before the catalog to their catalog course, and use course keys for groups
update public.classes c
set course_code = co.code
from public.courses co
where c.kind = 'class' and c.course_code is null and co.code = public.normalize_course(c.name);

update public.study_groups
set course = public.course_key(null, course)
where course <> '' and course is distinct from public.course_key(null, course);
`;
  fs.writeFileSync(OUT, header + "\n" + batches.join("\n\n") + "\n" + backfill);

  const subjects = new Set(list.map((c) => c.subject));
  console.log(`Wrote ${list.length} courses in ${subjects.size} subjects to ${path.relative(process.cwd(), OUT)}`);
  console.log(`${crossCount} cross-listed courses share a group with another code (e.g. ${list.filter((c) => find(c.code) !== c.code).slice(0, 3).map((c) => c.code + " → " + find(c.code)).join(", ")})`);
  if (skipped.length) console.log(`Skipped ${skipped.length} titles that didn't look like courses, e.g.:`, skipped.slice(0, 5));
})().catch((error) => {
  console.error("Import failed:", error.message);
  process.exitCode = 1;
});
