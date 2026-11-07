// StudySync - saving and loading classes.
// Classes are stored in schedule.json (created automatically next to this file).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "schedule.json");
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KINDS = ["class", "task", "other"]; // what can go on the calendar

function loadClasses() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return []; // no file yet → empty schedule
  }
}

function saveClasses(classes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(classes, null, 2));
}

// Check what the browser sent before saving it
function validateClass(input) {
  const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const kind = KINDS.includes(input.kind) ? input.kind : "class";
  // Room only applies to classes; the "What is it?" label only applies to Other
  const location = kind === "class" && typeof input.location === "string" ? input.location.trim() : "";
  const category = kind === "other" && typeof input.category === "string" ? input.category.trim() : "";
  const days = Array.isArray(input.days) ? DAY_KEYS.filter((d) => input.days.includes(d)) : [];

  if (!name || name.length > 60) return { error: "A name is required (60 characters max)." };
  if (kind === "other" && (!category || category.length > 30)) return { error: "Say what it is, e.g. Work (30 characters max)." };
  if (location.length > 60) return { error: "Room is 60 characters max." };
  if (days.length === 0) return { error: "Pick at least one day." };
  if (!isTime(input.start) || !isTime(input.end)) return { error: "Enter a start and end time." };
  if (input.end <= input.start) return { error: "End time must be after the start time." };

  return { value: { id: crypto.randomUUID(), kind, category, name, location, days, start: input.start, end: input.end } };
}

// Validate and save a new class. Returns { value } on success or { error } if something's wrong.
function addClass(input) {
  const result = validateClass(input);
  if (result.error) return result;
  const classes = loadClasses();
  classes.push(result.value);
  saveClasses(classes);
  return result;
}

function removeClass(id) {
  saveClasses(loadClasses().filter((c) => c.id !== id));
}

module.exports = { loadClasses, addClass, removeClass };
