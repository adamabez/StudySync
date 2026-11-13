// StudySync - builds a student's calendar feed (.ics), the format Google Calendar, Apple
// Calendar and Outlook subscribe to. routes/calendar.js serves it at their private link.
//
// What's in it, for the semester (lib/terms.js):
//   - classes: every week on their days, from the first to the last day of classes, skipping holidays
//   - weekly tasks and "other" items (work, gym...): every week, same dates, holidays included
//   - one-time items: on their date
//   - study group meetings (when studying with a group): every week, skipping holidays
// Solo study time isn't included: it's planned a week at a time and changes as the week does.
// Async classes have no time, so they're left out too.

const { daysBetween } = require("./terms");

const TZ = "America/Los_Angeles"; // Sac State
const BYDAY = { mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Pacific time, so events land at the right hour wherever the student's phone is
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", `TZID:${TZ}`,
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "TZNAME:PDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "TZNAME:PST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

// Text in a feed: backslashes, commas, semicolons and line breaks need escaping
const text = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 characters continue on the next line, starting with a space
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  out.push(rest);
  return out.join("\r\n");
}

const compact = (date) => date.replace(/-/g, "");            // "2026-08-31" → "20260831"
const clock = (time) => time.replace(":", "") + "00";         // "09:30" → "093000"
const local = (date, time) => `${compact(date)}T${clock(time)}`;
const dayOf = (date) => new Date(date + "T12:00:00Z").getUTCDay();

// The first date on or after `from` that falls on one of `days`
function firstMeeting(from, days) {
  const wanted = days.map((d) => DAY_INDEX[d]);
  for (const date of daysBetween(from, addDays(from, 6))) if (wanted.includes(dayOf(date))) return date;
  return null;
}

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function event({ uid, summary, location, description, date, start, end, days, term, skipHolidays }) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}@studysync`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
    `SUMMARY:${text(summary)}`,
  ];
  if (location) lines.push(`LOCATION:${text(location)}`);
  if (description) lines.push(`DESCRIPTION:${text(description)}`);
  if (days) {
    // Every week from the first meeting to the last day of classes (the day after, at 07:59 UTC,
    // is just past midnight Pacific, so the last day is included)
    const first = firstMeeting(term.start, days);
    if (!first || first > term.end) return [];
    lines.push(`DTSTART;TZID=${TZ}:${local(first, start)}`, `DTEND;TZID=${TZ}:${local(first, end)}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")};UNTIL=${compact(addDays(term.end, 1))}T075959Z`);
    const skipped = skipHolidays ? term.holidays.filter((h) => days.some((d) => DAY_INDEX[d] === dayOf(h.date))) : [];
    for (const h of skipped) lines.push(`EXDATE;TZID=${TZ}:${local(h.date, start)}`);
  } else {
    lines.push(`DTSTART;TZID=${TZ}:${local(date, start)}`, `DTEND;TZID=${TZ}:${local(date, end)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

const timed = (x) => /^\d{2}:\d{2}$/.test(x.start || "") && /^\d{2}:\d{2}$/.test(x.end || "") && x.end > x.start;
const validDays = (days) => (days || []).filter((d) => BYDAY[d]);

// data: what calendar_feed() returns { preference, items, groups }; term: lib/terms.js getTerm()
function buildFeed(data, term) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudySync//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text("StudySync · " + term.label)}`,
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];

  for (const item of data.items || []) {
    if (!timed(item)) continue; // async classes have no time
    const kind = item.kind || "class";
    const label = kind === "class" ? "Class" : kind === "task" ? "Task" : item.category || "Other";
    if (item.date) {
      lines.push(...event({ uid: item.id, summary: item.name, location: item.location, description: label + " · from StudySync", date: item.date, start: item.start, end: item.end }));
    } else {
      const days = validDays(item.days);
      if (!days.length) continue;
      lines.push(...event({ uid: item.id, summary: item.name, location: kind === "class" ? item.location : "", description: label + " · from StudySync",
        days, start: item.start, end: item.end, term, skipHolidays: kind === "class" }));
    }
  }

  if (data.preference === "group") {
    for (const group of data.groups || []) {
      const days = validDays(group.days);
      if (!timed(group) || !days.length) continue;
      lines.push(...event({ uid: "group-" + group.id, summary: "Study group: " + group.name, location: group.location,
        description: "Your StudySync study group. Check the group page for this week's place and who's coming.",
        days, start: group.start, end: group.end, term, skipHolidays: true }));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

module.exports = { buildFeed };
