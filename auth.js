// StudySync - login check and who's logged in.
//
// Login:  username = admin   password = 123
// (Practice login only — real apps never hard-code passwords like this.)

const crypto = require("crypto");

const USERNAME = "admin";
const PASSWORD = "123";

// Logged-in sessions live in memory, so restarting the server logs everyone out.
const sessions = new Set();

// Is this the right username and password?
function checkLogin(username, password) {
  return username === USERNAME && password === PASSWORD;
}

// Remember a new logged-in user. Returns the cookie to send back to the browser.
function startSession() {
  const id = crypto.randomUUID();
  sessions.add(id);
  return `session=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

// Read the session id from the browser's cookie
function getSessionId(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

function isLoggedIn(req) {
  return sessions.has(getSessionId(req));
}

// Forget this user. Returns a cookie that clears the browser's session.
function endSession(req) {
  sessions.delete(getSessionId(req));
  return "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

module.exports = { checkLogin, startSession, isLoggedIn, endSession };
