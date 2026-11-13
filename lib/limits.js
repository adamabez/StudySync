// StudySync - rate limits kept in memory (they reset when the server restarts).

// Remembers recent times per key, and says whether one more is allowed in the window
function limiter(max, windowMs) {
  const times = new Map(); // key → [times]
  return function allow(key) {
    const since = Date.now() - windowMs;
    const recent = (times.get(key) || []).filter((t) => t > since);
    if (times.size > 5_000) times.clear(); // never grows without limit
    if (recent.length >= max) return false;
    times.set(key, [...recent, Date.now()]);
    return true;
  };
}

// Meetup changes (spots, votes, RSVPs, moving a session): at most 30 a minute per student
const writeAllowed = limiter(30, 60 * 1000);

// Feedback without an account: at most 5 messages per visitor (IP) every 10 minutes
const allowFeedback = limiter(5, 10 * 60 * 1000);
function feedbackLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return !allowFeedback(ip);
}

module.exports = { writeAllowed, feedbackLimited };
