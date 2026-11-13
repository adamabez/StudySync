// StudySync - API: the student's calendar items (lib/schedule.js) and the Sac State course
// catalog the class picker uses (lib/courses.js, lib/sections.js).

const schedule = require("../lib/schedule");
const groups = require("../lib/groups");
const courses = require("../lib/courses");
const sections = require("../lib/sections");
const { sendJson, readJson } = require("../lib/http");

module.exports = [
  // --- Calendar items: classes, tasks and other busy times ---
  ["GET", "/api/classes", async ({ res, db }) => sendJson(res, await schedule.loadClasses(db))],

  ["POST", "/api/classes", ({ req, res, db }) => readJson(req, res, 10_000, async (input) => {
    const result = await schedule.addClass(db, input);
    if (result.error) return sendJson(res, { error: result.error }, 400);
    await groups.matchQuietly(db); // a new class might clash with their study group
    // extra: more time blocks of the same section (e.g. MWF 10:00 + Tue 10:30), already saved
    sendJson(res, { ...result.value, extra: result.extra || [] }, 201);
  })],

  ["PUT", "/api/classes/:id", ({ req, res, db, params }) => readJson(req, res, 10_000, async (input) => {
    const result = await schedule.updateClass(db, params.id, input);
    if (result.notFound) return sendJson(res, { error: "That item was already removed. Refresh the page." }, 404);
    if (result.error) return sendJson(res, { error: result.error }, 400);
    await groups.matchQuietly(db); // the new time might clash with their study group
    sendJson(res, result.value);
  })],

  ["DELETE", "/api/classes/:id", async ({ res, db, params }) => {
    await schedule.removeClass(db, params.id);
    await groups.matchQuietly(db); // more free time might mean a group fits now
    sendJson(res, { ok: true });
  }],

  // --- Course catalog: the class picker's suggestions ---
  ["GET", "/api/courses", async ({ res, url, db }) => {
    if (url.searchParams.has("subject")) return sendJson(res, courses.coursesInSubject(url.searchParams.get("subject")));
    sendJson(res, await courses.searchCourses(db, url.searchParams.get("q")));
  }],

  // Every subject A-Z, for browsing (MATH → its classes)
  ["GET", "/api/courses/subjects", ({ res }) => sendJson(res, courses.listSubjects())],

  // Sections of one course this term, from Sac State's class schedule
  ["GET", "/api/courses/sections", async ({ res, url }) => {
    const code = courses.normalizeCourse(url.searchParams.get("code"));
    try {
      sendJson(res, await sections.getSections(code));
    } catch (error) {
      console.error("Class schedule lookup failed:", error.message || error);
      sendJson(res, { error: "Couldn't reach Sac State's class schedule. Enter the days and times yourself." }, 502);
    }
  }],
];
