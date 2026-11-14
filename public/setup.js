// StudySync - first-login setup screen (runs in the browser).
// Step 1: add classes and other commitments (saved with the same /api/classes routes
// as the dashboard). Step 2: study alone or in a group? Step 3: hours a week. Finish → /landing.

const { DAY_SHORT: DAY_LABELS, formatTime } = window.studyFormat; // public/format.js
let items = []; // what's on the user's calendar so far

const $ = (id) => document.getElementById(id);
const chosenKind = () => document.querySelector('input[name="kind"]:checked').value;
const isAsyncChosen = () => chosenKind() === "class" && $("async").checked;

function describe(item) {
  const days = item.days.map((d) => DAY_LABELS[d]).join(", ");
  if (!item.start) return (days ? days + " · " : "") + "Asynchronous";
  return days + " · " + formatTime(item.start) + " – " + formatTime(item.end);
}

// Show the right fields: Room for classes, "What is it?" for everything else
function updateForm() {
  const kind = chosenKind();
  const isClass = kind === "class";
  $("add-form").dataset.kind = kind;
  $("name-label").textContent = isClass ? "Class name" : "Name";
  $("name").placeholder = isClass ? "Search, e.g. CSC 20 or Biology" : "e.g. Shift at the café";
  $("add-button").textContent = isClass ? "Add class" : "Add";
  $("location-field").hidden = !isClass;
  $("category-field").hidden = isClass;
  $("category").required = !isClass;
  $("async-field").hidden = !isClass;
  if (!isClass) $("async").checked = false;

  const isAsync = isAsyncChosen();
  $("add-form").classList.toggle("is-async", isAsync);
  $("start").required = !isAsync;
  $("end").required = !isAsync;
  $("days-label").textContent = isAsync ? "Days (optional):" : "Days:";
  $("form-error").textContent = "";
}

// The schedule so far, grouped under headings (Classes / Tasks / Work, clubs & other),
// each item in its own calendar color, same as the dashboard (public/colors.js)
const GROUPS = [
  { kind: "class", title: "Classes", icon: "📚" },
  { kind: "task", title: "Tasks", icon: "📝" },
  { kind: "other", title: "Work, clubs & other", icon: "🗓️" },
];
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function renderList() {
  const list = $("added-list");
  list.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "added-empty";
    empty.textContent = "Nothing added yet. Your classes and other plans will show up here.";
    list.appendChild(empty);
    return;
  }
  for (const group of GROUPS) {
    const mine = items
      .filter((item) => (item.kind || "class") === group.kind)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!mine.length) continue;

    const section = document.createElement("li");
    section.className = "added-group added-group-" + group.kind;
    const heading = document.createElement("h3");
    heading.className = "added-heading";
    heading.innerHTML = '<span class="added-heading-icon" aria-hidden="true">' + group.icon + "</span>";
    heading.append(group.title);
    const count = document.createElement("span");
    count.className = "added-count";
    count.textContent = mine.length;
    heading.appendChild(count);
    section.appendChild(heading);

    const cards = document.createElement("ul");
    cards.className = "added-cards";
    for (const item of mine) cards.appendChild(itemCard(item));
    section.appendChild(cards);
    list.appendChild(section);
  }
}

function itemCard(item) {
  const li = document.createElement("li");
  li.className = "added-item " + (item.kind || "class");
  li.style.setProperty("--c", window.studyColors.colorFor(item));

  const text = document.createElement("div");
  text.className = "added-text";
  const top = document.createElement("div");
  top.className = "added-top";
  const name = document.createElement("strong");
  name.textContent = item.name;
  top.appendChild(name);
  // Tag for tasks and "other" (WORK, GYM...), like on the dashboard
  if ((item.kind || "class") !== "class") {
    const tag = document.createElement("span");
    tag.className = "added-tag";
    tag.textContent = item.kind === "task" ? "Task" : item.category || "Other";
    top.appendChild(tag);
  }
  text.appendChild(top);

  // When: "↻ Every week" + day chips, or "📅 Once · Sat, Nov 15"; then the time (or "Asynchronous")
  const when = document.createElement("div");
  when.className = "added-when";
  const repeat = document.createElement("span");
  if (item.date) {
    const past = window.studyDates.isPast(item.date);
    li.classList.add("once");
    li.classList.toggle("past", past);
    repeat.className = "added-repeat once";
    repeat.textContent = "📅 Once · " + window.studyDates.label(item.date) + (past ? " (past)" : "");
    when.appendChild(repeat);
  } else {
    repeat.className = "added-repeat weekly";
    repeat.textContent = "↻ Every week";
    when.appendChild(repeat);
    for (const day of DAY_ORDER.filter((d) => item.days.includes(d))) {
      const chip = document.createElement("span");
      chip.className = "added-day";
      chip.textContent = DAY_LABELS[day];
      when.appendChild(chip);
    }
  }
  const time = document.createElement("span");
  time.className = "added-time";
  time.textContent = item.start ? formatTime(item.start) + " – " + formatTime(item.end) : "Asynchronous";
  when.appendChild(time);
  text.appendChild(when);

  if (item.location) {
    const where = document.createElement("span");
    where.className = "added-where";
    where.textContent = item.location;
    text.appendChild(where);
  }

  // Round ✕ in the corner → asks on the card first ("Remove CSC 130?  Yes, remove · Cancel")
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "added-remove";
  remove.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  remove.title = "Remove";
  remove.setAttribute("aria-label", "Remove " + item.name);

  const confirmBar = document.createElement("div");
  confirmBar.className = "added-confirm";
  confirmBar.hidden = true;
  confirmBar.setAttribute("role", "group");
  const question = document.createElement("span");
  question.textContent = "Remove " + item.name + "?";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "added-confirm-yes";
  yes.textContent = "Yes, remove";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "added-confirm-no";
  no.textContent = "Cancel";
  confirmBar.append(question, yes, no);

  const ask = (on) => {
    confirmBar.hidden = !on;
    remove.hidden = on;
    li.classList.toggle("confirming", on);
    (on ? no : remove).focus();
  };
  remove.addEventListener("click", () => ask(true));
  no.addEventListener("click", () => ask(false));
  confirmBar.addEventListener("keydown", (event) => { if (event.key === "Escape") ask(false); });
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    yes.textContent = "Removing…";
    const ok = await removeItem(item);
    if (!ok) { yes.disabled = false; yes.textContent = "Yes, remove"; }
  });

  li.append(text, remove, confirmBar);
  return li;
}

async function removeItem(item) {
  const res = await fetch("/api/classes/" + item.id, { method: "DELETE" }).catch(() => null);
  if (!res || !res.ok) {
    alert("Couldn't remove that. Try again.");
    return false;
  }
  items = items.filter((i) => i.id !== item.id);
  // Remember it so Cancel can put it back (something added this visit just disappears)
  if (addedIds.has(item.id)) addedIds.delete(item.id);
  else removedItems.push(item);
  renderList();
  return true;
}

// ---------- Back / Cancel (editing later, not first-time setup) ----------
// Adding and removing items saves straight away; the study settings below only save with Save.
// So leaving with changes asks: keep editing, revert (undo the adds/removes, drop the settings),
// or save and go back.
const addedIds = new Set(); // items added this visit
const removedItems = [];    // items removed this visit (to re-add on revert)
let savedSettings = "";     // the study settings as loaded

function currentSettings() {
  return JSON.stringify({
    preference: (document.querySelector('input[name="preference"]:checked') || {}).value || "",
    hours: chosenHours() || 0,
    length: (document.querySelector('input[name="length"]:checked') || {}).value || "",
    notes: $("study-notes").value.trim(),
  });
}

// Where leaving goes: a page picked in the header / tab bar (leaveTo), else the page they came
// from (study plan or dashboard), else the study plan
let leaveTo = null;
function backTo() {
  if (leaveTo) return leaveTo;
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && ["/dashboard", "/landing"].includes(from.pathname)) return from.pathname;
  } catch {
    // no referrer
  }
  return "/landing";
}

function changeSummary() {
  const parts = [];
  if (addedIds.size) parts.push("added " + addedIds.size + (addedIds.size === 1 ? " item" : " items"));
  if (removedItems.length) parts.push("removed " + removedItems.length + (removedItems.length === 1 ? " item" : " items"));
  const settings = currentSettings() !== savedSettings;
  if (!parts.length && !settings) return "";
  let text = parts.length ? "You " + parts.join(" and ") + (settings ? ", and changed your study settings." : ".") : "You changed your study settings.";
  return text + " Revert puts everything back the way it was.";
}

function leave(target) {
  leaveTo = typeof target === "string" ? target : null;
  const summary = changeSummary();
  if (!summary) return (window.location.href = backTo());
  $("leave-summary").textContent = summary;
  $("leave-save").textContent = leaveTo ? "Save & continue" : "Save & go back"; // a header link, or Back
  $("leave-error").textContent = "";
  $("leave-dialog").showModal();
  $("leave-keep").focus();
}

// Undo this visit's schedule changes: delete what was added, re-add what was removed
async function revertChanges() {
  const asBody = (item) => ({
    kind: item.kind || "class",
    name: item.name,
    category: item.category || "",
    location: item.location || "",
    days: item.days,
    start: item.start,
    end: item.end,
    async: !item.start,
    ...(item.date ? { repeat: "once", date: item.date } : { repeat: "weekly" }),
  });
  const results = await Promise.all([
    ...[...addedIds].map((id) => fetch("/api/classes/" + id, { method: "DELETE" }).then((r) => r.ok).catch(() => false)),
    ...removedItems.map((item) => fetch("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asBody(item)),
    }).then((r) => r.ok).catch(() => false)),
  ]);
  return results.every(Boolean);
}

$("back-top").addEventListener("click", () => leave());
$("cancel-bottom").addEventListener("click", () => leave());
// Editing later, the shared header and tab bar (public/nav.js) are here too: their links ask
// first if anything changed, the same as Back. Log out and the app window are left alone.
document.addEventListener("click", (event) => {
  if (!editing) return;
  const link = event.target.closest && event.target.closest(".app-nav a[href], .app-tabbar a[href]");
  if (!link || link.hasAttribute("data-install-app")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname === "/logout" || url.pathname === location.pathname) return;
  if (!changeSummary()) return; // nothing to lose: just go
  event.preventDefault();
  leave(url.pathname + url.search);
});
$("leave-keep").addEventListener("click", () => $("leave-dialog").close());
$("leave-revert").addEventListener("click", async () => {
  const button = $("leave-revert");
  button.disabled = true;
  button.textContent = "Reverting…";
  if (await revertChanges()) return (window.location.href = backTo());
  button.disabled = false;
  button.textContent = "Revert changes";
  $("leave-error").textContent = "Couldn't undo everything. Check your schedule and try again.";
});
$("leave-save").addEventListener("click", () => {
  $("leave-dialog").close();
  $("finish").click(); // saves the settings, then goes back
});

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = chosenKind();
  const body = {
    ...window.repeatPicker.value(), // { repeat: "once", date } for one-time items
    kind,
    name: $("name").value,
    start: $("start").value,
    end: $("end").value,
    location: $("location").value,
    category: $("category").value,
    async: isAsyncChosen(),
    days: [...document.querySelectorAll(".days .day-chip input:checked")].map((box) => box.value),
  };
  // Picked a section from the class schedule? The server saves its real times (and any second time block)
  const section = kind === "class" && window.coursePicker ? window.coursePicker.sectionFor(body.name) : "";
  if (section) body.section = section;
  const res = await fetch("/api/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("form-error").textContent = data.error || "Couldn't save that. Try again.";
    return;
  }
  const { extra = [], ...saved } = data; // extra: the section's other time blocks, also saved
  items.push(saved, ...extra);
  for (const item of [saved, ...extra]) addedIds.add(item.id); // so Cancel can undo it
  renderList();
  // Clear the name (keep the days and times: the next class is often similar)
  $("name").value = "";
  $("location").value = "";
  $("form-error").textContent = "";
  $("name").focus();
});

for (const radio of document.querySelectorAll('input[name="kind"]')) radio.addEventListener("change", updateForm);
$("async").addEventListener("change", updateForm);

// Session length only matters for Solo
function showLengthStep() {
  const picked = document.querySelector('input[name="preference"]:checked');
  $("length-step").hidden = !picked || picked.value !== "alone";
}
for (const radio of document.querySelectorAll('input[name="preference"]')) radio.addEventListener("change", showLengthStep);

$("finish").addEventListener("click", async () => {
  const picked = document.querySelector('input[name="preference"]:checked');
  if (!picked) {
    $("finish-error").textContent = "Pick Solo or Group.";
    return;
  }
  const weeklyHours = chosenHours();
  if (!Number.isInteger(weeklyHours) || weeklyHours < 1 || weeklyHours > 40) {
    $("finish-error").textContent = "Pick between 1 and 40 hours a week to study.";
    return;
  }
  $("finish").disabled = true;
  const body = { preference: picked.value, weeklyHours, studyNotes: $("study-notes").value };
  if (picked.value === "alone") body.sessionLength = (document.querySelector('input[name="length"]:checked') || {}).value || "medium";
  let res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Database not updated for session length yet: still finish setup without it
  if (res.status === 503) {
    delete body.sessionLength;
    res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    $("finish-error").textContent = data.error || "Couldn't save. Try again.";
    $("finish").disabled = false;
    return;
  }
  window.location.href = editing ? backTo() : "/landing";
});

// ---------- Skip for now (first time only) ----------
// Marks setup as done without a study style or goal, and goes to the dashboard. Classes they
// already added stay; everything else can be set later (Edit schedule / the study plan page).
async function skipSetup(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skip: true }),
  }).catch(() => null);
  if (!res || !res.ok) {
    $("finish-error").textContent = "Couldn't skip right now. Try again.";
    button.disabled = false;
    return;
  }
  window.location.href = "/dashboard";
}
$("skip-top").addEventListener("click", skipSetup);
$("skip-bottom").addEventListener("click", skipSetup);

// ---------- Weekly study goal: preset options, or "Other" with a number ----------
const PRESET_HOURS = [2, 4, 6, 8, 10, 15];

function chosenHours() {
  const picked = document.querySelector('input[name="hours"]:checked');
  if (!picked) return NaN;
  return picked.value === "other" ? Number($("weekly-hours").value) : Number(picked.value);
}

function setHours(hours) {
  const preset = PRESET_HOURS.includes(hours);
  $(preset ? "hours-" + hours : "hours-other").checked = true;
  if (!preset) $("weekly-hours").value = hours;
  updateHoursField();
}

function updateHoursField() {
  const isOther = $("hours-other").checked;
  $("hours-custom").hidden = !isOther;
  $("weekly-hours").required = isOther;
}

for (const radio of document.querySelectorAll('input[name="hours"]')) {
  radio.addEventListener("change", () => {
    updateHoursField();
    if ($("hours-other").checked) $("weekly-hours").focus();
  });
}

// Load what's already there (coming back to edit, or classes added on the dashboard)
async function load() {
  updateForm();
  const [classesRes, profileRes] = await Promise.all([fetch("/api/classes"), fetch("/api/profile")]);
  if (classesRes.ok) items = await classesRes.json();
  renderList();
  if (profileRes.ok) {
    const profile = await profileRes.json();
    const radio = document.querySelector('input[name="preference"][value="' + profile.preference + '"]');
    if (radio) radio.checked = true;
    setHours(profile.weeklyHours);
    const length = document.querySelector('input[name="length"][value="' + (profile.sessionLength || "medium") + '"]');
    if (length) length.checked = true;
    showLengthStep();
    // Study notes only matter when the AI plans study times
    $("notes-field").hidden = !profile.aiScheduling;
    $("study-notes").value = profile.studyNotes || "";
    if (profile.onboarded) $("finish").textContent = "Save";
    // Skipping only makes sense the first time through; Back / Cancel only when editing later
    $("skip-top").hidden = profile.onboarded;
    $("skip-bottom").hidden = profile.onboarded;
    editing = Boolean(profile.onboarded);
    $("back-top").hidden = !editing;
    document.body.classList.toggle("first-setup", !editing); // first time: no header or tab bar, just the steps
    $("cancel-bottom").hidden = !editing;
    if (editing) {
      $("setup-title").textContent = "Edit your schedule";
      $("setup-intro").textContent = "Change your classes and plans, and how you like to study.";
    }
  }
  savedSettings = currentSettings();
}
let editing = false; // true when changing an existing schedule (not first-time setup)
load();
