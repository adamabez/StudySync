// StudySync - Canvas integration: link a student's Canvas account and load their homework.
// The connection (school Canvas URL + personal access token) is stored in the Supabase
// "canvas_connections" table (see supabase/schema.sql). The token never goes to the browser.
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
  const { data, error } = await db.from("canvas_connections").select("canvas_url, access_token").maybeSingle();
  if (error) throw error;
  return data;
}

// Body { canvasUrl, token }. Checks the token with Canvas, then saves it.
async function connect(db, userId, input) {
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
    .upsert({ user_id: userId, canvas_url: canvasUrl, access_token: token, created_at: new Date().toISOString() });
  if (error) throw error;
  return { value: { connected: true, canvasUrl, name: profile.name || null } };
}

async function status(db) {
  const { data, error } = await db.from("canvas_connections").select("canvas_url").maybeSingle();
  if (error) throw error;
  return data ? { connected: true, canvasUrl: data.canvas_url } : { connected: false };
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

module.exports = { connect, status, disconnect, getAssignments, normalizeCanvasUrl, nextPageUrl, sortAssignments };
