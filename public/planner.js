// StudySync - study time planner. Shared by the server (require("./public/planner"))
// and the browser (window.StudyPlanner), so both always agree on what's free.
//
// Works out the free time in a student's week, plans study sessions that add up to
// their weekly goal in the calmest free times, and checks plans (e.g. ones the AI
// suggests) against the real schedule.
//
// Times are "HH:MM" strings outside this file and minutes since midnight inside it.

(function (root) {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  // ★ Change these to tune the suggestions
  const SETTINGS = {
    dayStart: "08:00",   // don't suggest anything earlier than this
    dayEnd: "22:00",     // ...or later than this
    minSession: 60,      // shortest study session (minutes), unless less is left of the goal
    maxSession: 120,     // longest study session (minutes)
    breakAfter: 15,      // breather after a class before studying (minutes)
    studySpacing: 30,    // at least this long between two study sessions on the same day (minutes)
    maxPerDay: 3,        // at most this many sessions per day (one per day first, then a second...)
    spreadBonus: 0.25,   // extra credit per day away from other study days (spreads sessions out)
  };

  // How calm each part of the day usually is (higher = better time to study).
  // Afternoons first, then evenings and mornings; lunch and the edges of the day last.
  const CALM_TIMES = [
    { from: "08:00", to: "09:00", score: 1, label: "Early morning" },
    { from: "09:00", to: "12:00", score: 2.5, label: "Morning" },
    { from: "12:00", to: "13:00", score: 1, label: "Lunchtime" },
    { from: "13:00", to: "17:00", score: 4, label: "Afternoon" },
    { from: "17:00", to: "20:00", score: 3, label: "Evening" },
    { from: "20:00", to: "22:00", score: 1, label: "Late evening" },
  ];

  const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const toTime = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

  function calmTimeAt(minute) {
    return CALM_TIMES.find((c) => minute >= toMinutes(c.from) && minute < toMinutes(c.to)) || { score: 0, label: "" };
  }

  // Label for a session, from the middle of it, e.g. "Afternoon"
  function labelFor(start, end) {
    return calmTimeAt(Math.floor((toMinutes(start) + toMinutes(end)) / 2)).label;
  }

  // Average calm score over a session, checked every 30 minutes
  function calmScore(start, end) {
    let total = 0;
    let count = 0;
    for (let m = start; m < end; m += 30) { total += calmTimeAt(m).score; count++; }
    return count ? total / count : 0;
  }

  // Free gaps on one day (in minutes), around everything on the calendar with a set time
  // (plus a break after each) and around study sessions already picked ([start, end] pairs)
  function freeGaps(calendar, dayKey, picked = []) {
    const busy = calendar
      .filter((item) => item.start && item.end && item.days.includes(dayKey))
      .map((item) => ({ from: toMinutes(item.start), to: toMinutes(item.end) + SETTINGS.breakAfter }))
      .concat(picked.map(([start, end]) => ({ from: start - SETTINGS.studySpacing, to: end + SETTINGS.studySpacing })))
      .sort((a, b) => a.from - b.from);

    const gaps = [];
    let cursor = toMinutes(SETTINGS.dayStart);
    for (const block of busy) {
      if (block.from > cursor) gaps.push({ from: cursor, to: block.from });
      cursor = Math.max(cursor, block.to);
    }
    const dayEnd = toMinutes(SETTINGS.dayEnd);
    if (dayEnd > cursor) gaps.push({ from: cursor, to: dayEnd });
    return gaps.map((g) => ({ from: g.from, to: Math.min(g.to, dayEnd) })).filter((g) => g.to > g.from);
  }

  // Every free window in the week long enough for a session, e.g. for the AI to choose from
  function freeWindows(calendar) {
    const windows = [];
    for (const day of DAY_KEYS) {
      for (const gap of freeGaps(calendar, day)) {
        if (gap.to - gap.from >= 30) windows.push({ day, start: toTime(gap.from), end: toTime(gap.to) });
      }
    }
    return windows;
  }

  // The best session to add next: the calmest free time on a day that has fewer than
  // `perDay` sessions so far. Sessions start on the hour or half hour.
  function bestSession(calendar, remaining, perDay, picked) {
    const want = Math.min(SETTINGS.maxSession, remaining);
    const shortest = Math.min(SETTINGS.minSession, remaining);
    const studyDays = DAY_KEYS.map((key, i) => (picked[key].length ? i : null)).filter((i) => i !== null);
    let best = null;
    DAY_KEYS.forEach((day, index) => {
      if (picked[day].length >= perDay) return;
      // How far is this day from the nearest day that already has studying? (capped at 2 days)
      const distance = studyDays.length ? Math.min(2, ...studyDays.map((i) => Math.abs(i - index))) : 2;
      for (const gap of freeGaps(calendar, day, picked[day])) {
        for (let start = Math.ceil(gap.from / 30) * 30; start + shortest <= gap.to; start += 30) {
          const end = start + Math.min(want, gap.to - start);
          const score = calmScore(start, end)
            + (end - start) / SETTINGS.maxSession   // a bit of credit for longer sessions
            + distance * SETTINGS.spreadBonus;      // ...and for spreading them out
          if (!best || score > best.score) best = { day, start, end, score };
        }
      }
    });
    return best;
  }

  // Plan sessions that add up to the weekly goal: one per day first (spread across the
  // week), then a second per day, and so on. Returns { sessions, found } where sessions
  // are { day, start, end } sorted by day and time, and found is the minutes planned.
  function planStudyTimes(calendar, goalMinutes) {
    const picked = Object.fromEntries(DAY_KEYS.map((key) => [key, []]));
    let remaining = goalMinutes;
    for (let perDay = 1; perDay <= SETTINGS.maxPerDay && remaining > 0; perDay++) {
      while (remaining > 0) {
        const session = bestSession(calendar, remaining, perDay, picked);
        if (!session) break;
        picked[session.day].push([session.start, session.end]);
        remaining -= session.end - session.start;
      }
    }
    const sessions = [];
    for (const day of DAY_KEYS) {
      for (const [start, end] of picked[day].sort((a, b) => a[0] - b[0])) {
        sessions.push({ day, start: toTime(start), end: toTime(end) });
      }
    }
    return { sessions, found: goalMinutes - remaining };
  }

  // Check a plan from somewhere else (the AI) against the real schedule.
  // Returns null if it's fine, or a short reason it isn't.
  function checkPlan(calendar, sessions, goalMinutes) {
    if (!Array.isArray(sessions)) return "no sessions";
    const byDay = Object.fromEntries(DAY_KEYS.map((key) => [key, []]));
    let total = 0;
    for (const s of sessions) {
      if (!s || !DAY_KEYS.includes(s.day) || !isTime(s.start) || !isTime(s.end)) return "bad day or time";
      const start = toMinutes(s.start);
      const end = toMinutes(s.end);
      if (end - start < 30 || end - start > SETTINGS.maxSession) return "session too short or too long";
      const fits = freeGaps(calendar, s.day).some((g) => start >= g.from && end <= g.to);
      if (!fits) return "clashes with the schedule (" + s.day + " " + s.start + ")";
      byDay[s.day].push([start, end]);
      total += end - start;
    }
    for (const day of DAY_KEYS) {
      const list = byDay[day].sort((a, b) => a[0] - b[0]);
      if (list.length > SETTINGS.maxPerDay) return "too many sessions on " + day;
      for (let i = 1; i < list.length; i++) {
        if (list[i][0] < list[i - 1][1] + SETTINGS.studySpacing) return "sessions too close together on " + day;
      }
    }
    // Must reach the goal (or as close as the algorithm can get), without overshooting by much
    const reachable = Math.min(goalMinutes, planStudyTimes(calendar, goalMinutes).found);
    if (total < reachable - 30) return "doesn't reach the weekly goal";
    if (total > goalMinutes + 30) return "goes well over the weekly goal";
    return null;
  }

  const api = { DAY_KEYS, SETTINGS, CALM_TIMES, isTime, toMinutes, toTime, labelFor, freeWindows, planStudyTimes, checkPlan };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StudyPlanner = api;
})(this);
