// StudySync - Canvas integration: link a student's Canvas account and load their homework.
// The connection is stored in the Supabase "canvas_connections" table (see supabase/schema.sql)
// and never goes to the browser. There are two ways to connect:
//   1. Calendar Feed link (works everywhere, including schools like Sac State that don't let
//      students make access tokens). Gives every assignment and its due date, but not whether
//      it was turned in, so students tick off finished work (stored in "homework_done").
//   2. Personal access token (if the school allows it). Gives submissions and scores too.
//
// Every function takes `db` first: the Supabase client for the logged-in user, from
// auth.supabaseFor(req). Row Level Security means each user only sees their own connection.
//
// Functions return { value } on success or { error, status } when something's wrong,
// so server.js can pass the message straight to the browser.

const REQUEST_TIMEOUT_MS = 15_000; // give up on a slow Canvas request after 15 seconds
const MAX_PAGES = 20;              // safety limit when following Canvas's page links (100 items each)

// ---------- Checking what the browser sent ----------

// Turns "csus.instructure.com" or "https://csus.instructure.com/courses/1" into
// "https://csus.instructure.com". Only https, and no local or private addresses, because
// our server sends requests to this address.
function normalizeCanvasUrl(input) {
  let text = typeof input === "string" ? input.trim() : "";
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isIpAddress = /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[");
  const isLocal = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
  if (url.protocol !== "https:" || !host.includes(".") || isIpAddress || isLocal) return null;
  if (url.username || url.password || url.port) return null;
  return url.origin;
}

function validateToken(input) {
  const token = typeof input === "string" ? input.trim() : "";
  if (!token || token.length > 500 || /\s/.test(token)) return null;
  return token;
}

// ---------- Talking to Canvas ----------

class CanvasError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // the HTTP status we send back to the browser
  }
}

// Canvas splits long lists into pages. The Link header says where the next page is:
//   Link: <https://school.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next", ...
function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return null;
}

// GET a Canvas API path. Follows every page for lists, and returns the combined result.
async function canvasGet(canvasUrl, token, apiPath) {
  let url = new URL(apiPath, canvasUrl);
  if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "100");
  let combined = null;

  for (let page = 0; url && page < MAX_PAGES; page++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error", // a redirect usually means a wrong URL; don't send the token elsewhere
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("Canvas request failed:", error.message);
      throw new CanvasError("Couldn't reach Canvas. Check the Canvas URL and your internet connection.", 502);
    }

    if (response.status === 401) throw new CanvasError("Canvas didn't accept the access token. Make a new token in Canvas and connect again.", 401);
    if (response.status === 403) throw new CanvasError("Canvas says this token isn't allowed to see that.", 403);
    if (!response.ok) throw new CanvasError(`Canvas answered with an error (${response.status}). Try again in a minute.`, 502);

    let data;
    try {
      data = await response.json();
    } catch {
      throw new CanvasError("That address didn't answer like Canvas does. Check the Canvas URL.", 400);
    }
    if (!Array.isArray(data)) return data; // a single object, not a list: no pages to follow

    combined = (combined || []).concat(data);
    const next = nextPageUrl(response.headers.get("link"));
    // Only follow page links on the same Canvas site, so the token never goes anywhere else
    url = next && new URL(next).origin === canvasUrl ? new URL(next) : null;
  }
  return combined || [];
}

// ---------- The saved connection ----------

async function loadConnection(db) {
  const { data, error } = await db.from("canvas_connections").select("canvas_url, access_token, feed_url").maybeSingle();
  if (error) throw error;
  return data;
}

// Body { feedUrl } (Calendar Feed) or { canvasUrl, token } (access token).
// Checks it works with Canvas, then saves it.
async function connect(db, userId, input) {
  if (input.feedUrl !== undefined) return connectFeed(db, userId, input.feedUrl);

  const canvasUrl = normalizeCanvasUrl(input.canvasUrl);
  const token = validateToken(input.token);
  if (!canvasUrl) return { error: "Enter your school's Canvas address, e.g. https://csus.instructure.com", status: 400 };
  if (!token) return { error: "Paste your Canvas access token.", status: 400 };

  let profile;
  try {
    profile = await canvasGet(canvasUrl, token, "/api/v1/users/self");
  } catch (error) {
    if (error instanceof CanvasError) return { error: error.message, status: error.status === 401 ? 400 : error.status };
    throw error;
  }
  if (!profile || typeof profile !== "object" || !("id" in profile)) {
    return { error: "That address didn't answer like Canvas does. Check the Canvas URL.", status: 400 };
  }

  const { error } = await db
    .from("canvas_connections")
    .upsert({ user_id: userId, canvas_url: canvasUrl, access_token: token, feed_url: null, created_at: new Date().toISOString() });
  if (error) throw error;
  return { value: { connected: true, canvasUrl, mode: "token", name: profile.name || null } };
}

async function connectFeed(db, userId, input) {
  const feedUrl = normalizeFeedUrl(input);
  if (!feedUrl) {
    return { error: "Paste the Calendar Feed link from Canvas. It looks like https://csus.instructure.com/feeds/calendars/user_….ics", status: 400 };
  }
  try {
    await fetchFeed(feedUrl);
  } catch (error) {
    if (error instanceof CanvasError) return { error: error.message, status: 400 };
    throw error;
  }

  const canvasUrl = new URL(feedUrl).origin;
  const { error } = await db
    .from("canvas_connections")
    .upsert({ user_id: userId, canvas_url: canvasUrl, access_token: null, feed_url: feedUrl, created_at: new Date().toISOString() });
  if (error) throw error;
  return { value: { connected: true, canvasUrl, mode: "feed" } };
}

async function status(db) {
  const { data, error } = await db.from("canvas_connections").select("canvas_url, feed_url").maybeSingle();
  if (error) throw error;
  return data ? { connected: true, canvasUrl: data.canvas_url, mode: data.feed_url ? "feed" : "token" } : { connected: false };
}

// Body { id, done }. Ticks a Calendar Feed assignment off as finished, or unticks it.
async function setDone(db, userId, input) {
  const id = typeof input.id === "string" ? input.id : "";
  if (!/^[\w-]{1,80}$/.test(id) || typeof input.done !== "boolean") return { error: "Bad request", status: 400 };
  const table = db.from("homework_done");
  const { error } = input.done
    ? await table.upsert({ user_id: userId, assignment_id: id })
    : await table.delete().eq("user_id", userId).eq("assignment_id", id);
  if (error) throw error;
  return { value: { id, done: input.done } };
}

// ---------- Calendar Feed ----------
//
// Canvas → Calendar → "Calendar Feed" gives each student a private link like
//   https://csus.instructure.com/feeds/calendars/user_AbC123.ics
// It's an iCalendar file: one VEVENT per assignment or calendar event, e.g.
//   BEGIN:VEVENT
//   DTSTART:20261110T075900Z
//   SUMMARY:Essay draft [ENGL 20-01 Fall 2026]
//   URL;VALUE=URI:https://csus.instructure.com/calendar?include_contexts=course_123&month=11#assignment_456
//   UID:event-assignment-456
//   END:VEVENT

const MISSING_WINDOW_DAYS = 21; // past-due work older than this is left out, so old classes don't flood "Missing"

function normalizeFeedUrl(input) {
  const text = (typeof input === "string" ? input.trim() : "").replace(/^webcals?:\/\//i, "https://");
  const origin = normalizeCanvasUrl(text);
  if (!origin || !/^https:\/\//i.test(text)) return null;
  const { pathname } = new URL(text);
  if (!/^\/feeds\/calendars\/user_[A-Za-z0-9]+\.ics$/.test(pathname)) return null;
  return origin + pathname;
}

async function fetchFeed(feedUrl) {
  let response;
  try {
    response = await fetch(feedUrl, { redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    console.error("Canvas feed request failed:", error.message);
    throw new CanvasError("Couldn't reach Canvas. Check the link and your internet connection.", 502);
  }
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new CanvasError("Canvas doesn't recognize that Calendar Feed link. Copy it again from Canvas → Calendar → Calendar Feed.", 401);
  }
  if (!response.ok) throw new CanvasError(`Canvas answered with an error (${response.status}). Try again in a minute.`, 502);
  const text = await response.text();
  if (!text.startsWith("BEGIN:VCALENDAR")) throw new CanvasError("That link isn't a Canvas Calendar Feed. Copy it from Canvas → Calendar → Calendar Feed.", 400);
  return text;
}

// Reads the events out of an iCalendar file. Each property becomes { value, params }.
function parseIcs(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n"); // long lines continue with a space
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      current[name.toUpperCase()] = {
        value: line.slice(colon + 1),
        params: Object.fromEntries(params.map((p) => {
          const [key, value = ""] = p.split("=");
          return [key.toUpperCase(), value.replace(/^"|"$/g, "")];
        })),
      };
    }
  }
  return events;
}

const unescapeIcs = (text) => text.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// A wall-clock time in a named time zone (e.g. America/Los_Angeles) → the real moment
function zonedTime(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = Object.fromEntries(format.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const shown = Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess - (shown - guess));
  } catch {
    return new Date(y, mo - 1, d, h, mi, s); // unknown time zone: use the server's
  }
}

// DTSTART → ISO date string. All-day due dates count as due at 11:59 PM that day.
function icsDate(property) {
  if (!property) return null;
  const { value, params } = property;
  const day = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) return new Date(+day[1], day[2] - 1, +day[3], 23, 59).toISOString();
  const t = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!t) return null;
  const parts = t.slice(1, 7).map(Number);
  if (t[7] === "Z") return new Date(Date.UTC(parts[0], parts[1] - 1, ...parts.slice(2))).toISOString();
  if (params.TZID) return zonedTime(...parts, params.TZID).toISOString();
  return new Date(parts[0], parts[1] - 1, ...parts.slice(2)).toISOString();
}

// Calendar events → assignments { id, name, course, dueAt, url } (other events are skipped)
function feedAssignments(events, canvasUrl) {
  const byId = new Map();
  for (const event of events) {
    const uid = event.UID ? event.UID.value : "";
    if (!/assignment/.test(uid)) continue; // a class meeting or other calendar event, not homework

    const link = event.URL ? event.URL.value : "";
    const assignmentId = (link.match(/#assignment_(\d+)/) || uid.match(/assignment-(\d+)$/) || [])[1];
    const courseId = (link.match(/include_contexts=course_(\d+)/) || [])[1];
    const id = assignmentId || uid.replace(/[^\w-]/g, "").slice(0, 80);
    if (!id || byId.has(id)) continue;

    const summary = unescapeIcs(event.SUMMARY ? event.SUMMARY.value : "");
    const titled = summary.match(/^(.*?)\s*\[([^\]]+)\]$/); // "Lab 4 [CSC 130-01 Fall 2026]"
    let url = null;
    if (assignmentId && courseId) url = `${canvasUrl}/courses/${courseId}/assignments/${assignmentId}`;
    else if (link.startsWith(`${canvasUrl}/`)) url = link;

    byId.set(id, {
      id,
      name: (titled ? titled[1] : summary) || "Untitled assignment",
      course: titled ? titled[2] : "",
      dueAt: icsDate(event.DTSTART),
      url,
    });
  }
  return [...byId.values()];
}

// Missing = past due and not ticked off; completed = ticked off; upcoming = everything else
function sortFeedAssignments(assignments, doneIds, now = new Date()) {
  const result = { missing: [], completed: [], upcoming: [] };
  const oldest = now.getTime() - MISSING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  for (const assignment of assignments) {
    const item = { ...assignment, checkable: true };
    const due = item.dueAt ? new Date(item.dueAt).getTime() : null;
    if (doneIds.has(item.id)) {
      if (due === null || due >= oldest) result.completed.push({ ...item, done: true, score: null, pointsPossible: null });
    } else if (due !== null && due < now.getTime()) {
      if (due >= oldest) result.missing.push(item);
    } else {
      result.upcoming.push(item);
    }
  }
  result.missing.sort(byDueDate);
  result.upcoming.sort(byDueDate);
  result.completed.sort((a, b) => byDueDate(b, a));
  return result;
}

async function getFeedAssignments(db, connection) {
  let text;
  try {
    text = await fetchFeed(connection.feed_url);
  } catch (error) {
    if (!(error instanceof CanvasError)) throw error;
    if (error.status === 401) return { error: error.message, status: 409, reconnect: true };
    return { error: error.message, status: error.status };
  }
  const { data, error } = await db.from("homework_done").select("assignment_id");
  if (error) throw error;
  const doneIds = new Set(data.map((row) => row.assignment_id));
  const assignments = feedAssignments(parseIcs(text), connection.canvas_url);
  return { value: { ...sortFeedAssignments(assignments, doneIds), source: "feed" } };
}

async function disconnect(db, userId) {
  const { error } = await db.from("canvas_connections").delete().eq("user_id", userId);
  if (error) throw error;
}

// ---------- Homework: missing, completed, upcoming ----------

const DONE_STATES = ["submitted", "graded", "pending_review"];
const NO_SUBMISSION_TYPES = ["none", "not_graded", "on_paper", "wiki_page"]; // nothing to turn in online

function isCompleted(submission) {
  if (!submission) return false;
  return Boolean(submission.excused || submission.submitted_at || DONE_STATES.includes(submission.workflow_state));
}

function byDueDate(a, b) {
  if (!a.dueAt) return 1; // no due date goes last
  if (!b.dueAt) return -1;
  return a.dueAt.localeCompare(b.dueAt);
}

// Sorts Canvas assignments into the shape the dashboard expects (see TEAM_PLAN.md)
function sortAssignments(assignments, missingIds, now = new Date()) {
  const result = { missing: [], completed: [], upcoming: [] };

  for (const { assignment, course } of assignments) {
    const submission = assignment.submission;
    const item = {
      id: String(assignment.id),
      name: assignment.name,
      course,
      dueAt: assignment.due_at || null,
      url: assignment.html_url,
    };
    const types = assignment.submission_types || [];

    if (isCompleted(submission)) {
      const graded = submission.workflow_state === "graded" && typeof submission.score === "number";
      result.completed.push({ ...item, score: graded ? submission.score : null, pointsPossible: assignment.points_possible ?? null });
    } else if (missingIds.has(item.id) || submission?.missing) {
      result.missing.push(item);
    } else if (types.some((t) => NO_SUBMISSION_TYPES.includes(t))) {
      continue; // nothing to submit in Canvas, so it's never missing or upcoming
    } else if (!item.dueAt || new Date(item.dueAt) >= now) {
      result.upcoming.push(item);
    }
    // Past due, not submitted and Canvas doesn't call it missing (e.g. late work closed): left out
  }

  result.missing.sort(byDueDate);
  result.upcoming.sort(byDueDate);
  result.completed.sort((a, b) => byDueDate(b, a)); // most recent first
  return result;
}

async function getAssignments(db) {
  const connection = await loadConnection(db);
  if (!connection) return { error: "Connect your Canvas account first.", status: 404 };
  if (connection.feed_url) return getFeedAssignments(db, connection);
  const { canvas_url: canvasUrl, access_token: token } = connection;

  try {
    const [courses, missing] = await Promise.all([
      canvasGet(canvasUrl, token, "/api/v1/courses?enrollment_state=active"),
      canvasGet(canvasUrl, token, "/api/v1/users/self/missing_submissions"),
    ]);
    const missingIds = new Set(missing.map((a) => String(a.id)));
    const activeCourses = courses.filter((c) => c && c.id && !c.access_restricted_by_date);

    const perCourse = await Promise.all(
      activeCourses.map(async (course) => {
        const label = course.course_code || course.name || "Course";
        try {
          const list = await canvasGet(canvasUrl, token, `/api/v1/courses/${course.id}/assignments?include[]=submission`);
          return list.filter((a) => a.published !== false).map((assignment) => ({ assignment, course: label }));
        } catch (error) {
          if (error instanceof CanvasError && error.status === 403) return []; // course hides its assignments
          throw error;
        }
      })
    );

    // Canvas can report missing work from a course that isn't in the active list: keep it anyway
    const all = perCourse.flat();
    const seen = new Set(all.map(({ assignment }) => String(assignment.id)));
    const courseNames = new Map(activeCourses.map((c) => [c.id, c.course_code || c.name]));
    for (const a of missing) {
      if (!seen.has(String(a.id))) all.push({ assignment: a, course: courseNames.get(a.course_id) || "" });
    }

    return { value: sortAssignments(all, missingIds) };
  } catch (error) {
    if (error instanceof CanvasError) {
      // 401 would look like "not logged in to StudySync", so the token problem gets its own answer
      if (error.status === 401) return { error: error.message, status: 409, reconnect: true };
      return { error: error.message, status: error.status };
    }
    throw error;
  }
}

module.exports = {
  connect, status, disconnect, getAssignments, setDone,
  // exported for testing
  normalizeCanvasUrl, nextPageUrl, sortAssignments, normalizeFeedUrl, parseIcs, icsDate, feedAssignments, sortFeedAssignments,
};
