// StudySync - dashboard calendar (runs in the browser, not on the server).
// Talks to the server's /api/classes routes to load, add, edit and remove classes.

const DAYS = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
  ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
];
let classes = []; // everything on the calendar: classes, tasks and "other" items
let studyTimes = []; // planned study sessions or study group meetings (from /api/study-times, read-only)
let editingId = null; // the item being edited in the form (pencil → Edit), or null when adding

// What the "Add a…" dropdown changes for each choice
const KINDS = {
  class: { nameLabel: "Class name", placeholder: "Search, e.g. CSC 20 or Biology", button: "Add class" },
  task: { nameLabel: "Task", placeholder: "e.g. Finish lab report", button: "Add task" },
  other: { nameLabel: "Name", placeholder: "e.g. Shift at the café", button: "Add" },
};

// Older saved items have no kind, so treat them as classes
const kindOf = (item) => item.kind || "class";

// Show the right fields for the chosen kind (Room only for classes, "What is it?" only for Other)
function updateFormForKind() {
  const kind = document.getElementById("kind").value;
  const k = KINDS[kind];
  document.getElementById("add-form").dataset.kind = kind;
  document.getElementById("name-label").textContent = k.nameLabel;
  document.getElementById("name").placeholder = k.placeholder;
  document.getElementById("add-button").textContent = editingId ? "Save changes" : k.button;
  document.getElementById("location-field").hidden = kind !== "class";
  document.getElementById("category-field").hidden = kind !== "other";
  document.getElementById("category").required = kind === "other";
  document.getElementById("async-field").hidden = kind !== "class";
  if (kind !== "class") document.getElementById("async").checked = false;
  updateFormForAsync();
  document.getElementById("form-error").textContent = "";
}

// Async classes have no set time, and picking days is optional
function isAsyncChosen() {
  return document.getElementById("kind").value === "class" && document.getElementById("async").checked;
}

function updateFormForAsync() {
  const isAsync = isAsyncChosen();
  document.getElementById("add-form").classList.toggle("is-async", isAsync);
  document.getElementById("start").required = !isAsync;
  document.getElementById("end").required = !isAsync;
  document.getElementById("days-label").textContent = isAsync ? "Days (optional):" : "Days:";
}

// Async classes have no start time
const isAsyncItem = (item) => !item.start;

// Turn "14:30" into "2:30 PM"
function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ampm;
}

// Give each class its own color, based on its name
// ★ The ONLY place calendar colors are set — cards and the color key both use this.
// Each kind has its own color family (hue range on the color wheel, in degrees).
// Color wheel: 0 red · 60 yellow · 120 green · 200 blue · 270 purple · 330 pink
// Every item gets its own shade inside its family, based on its name.
const COLOR_FAMILIES = {
  class: { from: 110, span: 110 }, // greens → teals → blues
  task: { from: 335, span: 50 },   // pinks → reds → oranges
  other: { from: 255, span: 45 },  // violets → purples
};

// A color at some point inside a family's range (step 0 = start of the range)
function familyColor(family, step) {
  return "hsl(" + ((family.from + step) % 360) + ", 60%, 48%)";
}

function colorFor(item) {
  const family = COLOR_FAMILIES[kindOf(item)];
  let hash = 0;
  for (const ch of item.name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return familyColor(family, hash % family.span);
}

// Color the key next to "Your week" so it always matches COLOR_FAMILIES
function paintColorKey() {
  for (const [kind, family] of Object.entries(COLOR_FAMILIES)) {
    const swatch = document.querySelector(".swatch." + kind);
    if (!swatch) continue;
    const start = familyColor(family, 0);
    const middle = familyColor(family, Math.floor(family.span / 2));
    const end = familyColor(family, family.span - 1);
    swatch.style.background = "linear-gradient(90deg, " + start + ", " + middle + ", " + end + ")";
  }
}

// Draw the Monday–Sunday grid
function render() {
  // Let the Virtual Notebook know, so its course list stays up to date
  document.dispatchEvent(new CustomEvent("classes-changed", { detail: classes.filter((c) => kindOf(c) === "class") }));

  const week = document.getElementById("week");
  week.innerHTML = "";
  const todayKey = DAYS[(new Date().getDay() + 6) % 7][0]; // JS weeks start on Sunday

  for (const [key, label] of DAYS) {
    const col = document.createElement("div");
    col.className = "day-col" + (key === todayKey ? " today" : "");

    const title = document.createElement("h3");
    title.textContent = label;
    col.appendChild(title);

    const todays = [...classes, ...studyTimes]
      .filter((c) => c.days.includes(key))
      .sort((a, b) => (a.start || "").localeCompare(b.start || "")); // async (no time) first

    if (todays.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.innerHTML = '<span class="empty-icon" aria-hidden="true">☀️</span>Nothing yet!';
      col.appendChild(empty);
    }

    for (const c of todays) col.appendChild(c.type ? makeStudyCard(c) : makeCard(c));
    col.appendChild(makeDayAdd(key, label));
    week.appendChild(col);
  }

  // Async classes with no days go in their own row above the week
  const noDays = classes.filter((c) => c.days.length === 0);
  const asyncList = document.getElementById("async-list");
  asyncList.innerHTML = "";
  for (const c of noDays) asyncList.appendChild(makeCard(c));
  document.getElementById("async-row").hidden = noDays.length === 0;
}

// One item on the calendar
function makeCard(c) {
  const card = document.createElement("div");
  card.className = "class-card " + kindOf(c);
  card.style.setProperty("--c", colorFor(c));

  const name = document.createElement("strong");
  name.textContent = c.name;

  // Tasks and "other" items get a small tag so they stand out from classes
  if (kindOf(c) !== "class") {
    const tag = document.createElement("span");
    tag.className = "kind-tag";
    tag.textContent = kindOf(c) === "task" ? "Task" : c.category;
    card.appendChild(tag);
  }
  const meta = document.createElement("div");
  meta.className = "meta";
  const when = isAsyncItem(c) ? "Asynchronous" : formatTime(c.start) + " – " + formatTime(c.end);
  meta.textContent = when + (c.location ? " · " + c.location : "");

  // Pencil in the top right → a small menu with Edit and Delete
  const pencil = document.createElement("button");
  pencil.className = "card-menu-button";
  pencil.type = "button";
  pencil.title = "Edit or delete";
  pencil.setAttribute("aria-label", "Edit or delete " + c.name);
  pencil.setAttribute("aria-haspopup", "menu");
  pencil.setAttribute("aria-expanded", "false");
  pencil.innerHTML = PENCIL_SVG;
  pencil.onclick = (e) => {
    e.stopPropagation(); // don't let the "click outside closes the menu" listener see this click
    const wasOpen = pencil.getAttribute("aria-expanded") === "true";
    closeCardMenu();
    if (!wasOpen) openCardMenu(card, pencil, c);
  };

  card.append(name, meta, pencil);
  return card;
}

// A study session or study group meeting. Read-only: it's planned for you, so no pencil.
function makeStudyCard(s) {
  const card = document.createElement("div");
  card.className = "class-card study-time";
  card.title = "Planned for you by StudySync";

  // Sparkle badge in the corner: this came from StudySync, not the student's own schedule
  const sparkle = document.createElement("span");
  sparkle.className = "study-sparkle";
  sparkle.setAttribute("aria-hidden", "true");
  sparkle.textContent = "✦";

  const tag = document.createElement("span");
  tag.className = "kind-tag";
  tag.textContent = s.type === "group" ? "Study group" : "Study";

  // Screen readers get the "planned by StudySync" part in words
  const hidden = document.createElement("span");
  hidden.className = "visually-hidden";
  hidden.textContent = "Planned by StudySync: ";

  const name = document.createElement("strong");
  name.textContent = s.name;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = formatTime(s.start) + " – " + formatTime(s.end) + (s.note ? " · " + s.note : "");

  card.append(sparkle, hidden, tag, name, meta);
  return card;
}

const PENCIL_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path d="M11.2 2.3a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L5.6 12.9 2.5 13.5l.6-3.1z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path d="M10 3.5l2.5 2.5" stroke="currentColor" stroke-width="1.5"/></svg>';

// "+" at the bottom of each day → a small menu: Class / Task / Other
function makeDayAdd(dayKey, dayLabel) {
  const wrap = document.createElement("div");
  wrap.className = "day-add";

  const plus = document.createElement("button");
  plus.className = "day-add-button";
  plus.type = "button";
  plus.title = "Add to " + dayLabel;
  plus.setAttribute("aria-label", "Add something on " + dayLabel);
  plus.setAttribute("aria-haspopup", "menu");
  plus.setAttribute("aria-expanded", "false");
  plus.textContent = "+";
  plus.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = plus.getAttribute("aria-expanded") === "true";
    closeCardMenu();
    if (!wasOpen) {
      openMenuIn(wrap, plus, [
        { label: "Class", onClick: () => startAdding("class", dayKey) },
        { label: "Task", onClick: () => startAdding("task", dayKey) },
        { label: "Other (work, gym…)", onClick: () => startAdding("other", dayKey) },
      ]);
    }
  };

  wrap.appendChild(plus);
  return wrap;
}

// ----- Small pop-up menus (pencil and "+"). Only one is open at a time. -----
let openMenu = null; // { menu, button }

// items: [{ label, onClick, danger }]
function openMenuIn(container, button, items) {
  const menu = document.createElement("div");
  menu.className = "card-menu";
  menu.setAttribute("role", "menu");

  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (item.danger) b.className = "danger";
    b.textContent = item.label;
    b.onclick = () => { closeCardMenu(); item.onClick(); };
    menu.appendChild(b);
  }

  menu.addEventListener("click", (e) => e.stopPropagation());
  container.appendChild(menu);
  button.setAttribute("aria-expanded", "true");
  openMenu = { menu, button };
  menu.firstChild.focus();
}

function openCardMenu(card, button, c) {
  openMenuIn(card, button, [
    { label: "Edit", onClick: () => startEditing(c) },
    { label: "Delete", onClick: () => removeClass(c), danger: true },
  ]);
}

function closeCardMenu({ returnFocus = false } = {}) {
  if (!openMenu) return;
  openMenu.menu.remove();
  openMenu.button.setAttribute("aria-expanded", "false");
  if (returnFocus) openMenu.button.focus();
  openMenu = null;
}

// Click anywhere else, or press Escape, to close the menu
document.addEventListener("click", () => closeCardMenu());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCardMenu({ returnFocus: true });
});

// Open the Add section if it was collapsed, then bring the form into view
function showAddForm() {
  const toggle = document.querySelector('.collapse-toggle[data-target="add-body"]');
  if (toggle && toggle.getAttribute("aria-expanded") === "false") toggle.click();
  document.getElementById("add-body").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("name").focus({ preventScroll: true });
}

// "+" on a day → a fresh Add form for that kind, with only that day ticked
function startAdding(kind, dayKey) {
  if (editingId) stopEditing();
  document.getElementById("add-form").reset();
  document.getElementById("kind").value = kind;
  updateFormForKind();
  for (const [key] of DAYS) document.getElementById("day-" + key).checked = key === dayKey;
  showAddForm();
}

// ----- Editing: the Add form doubles as the edit form -----
function startEditing(c) {
  editingId = c.id;
  const kind = kindOf(c);
  document.getElementById("kind").value = kind;
  updateFormForKind(); // shows the right fields and the "Save changes" button

  document.getElementById("name").value = c.name;
  document.getElementById("location").value = c.location || "";
  document.getElementById("category").value = c.category || "";
  document.getElementById("async").checked = kind === "class" && isAsyncItem(c);
  document.getElementById("start").value = c.start || "";
  document.getElementById("end").value = c.end || "";
  for (const [key] of DAYS) document.getElementById("day-" + key).checked = c.days.includes(key);
  updateFormForAsync();

  document.getElementById("edit-name").textContent = c.name;
  document.getElementById("edit-banner").hidden = false;

  showAddForm();
}

function stopEditing() {
  editingId = null;
  document.getElementById("edit-banner").hidden = true;
  document.getElementById("add-form").reset();
  updateFormForKind(); // back to "Add class" / "Add task" / "Add"
}

async function loadClasses() {
  const res = await fetch("/api/classes");
  if (res.status === 401) return (window.location.href = "/");
  classes = await res.json();
  render();
  loadStudyTimes();
}

// Study times depend on the schedule, so reload them after every change.
// If they can't load (e.g. the database setup is out of date), the calendar just goes without.
async function loadStudyTimes() {
  try {
    const res = await fetch("/api/study-times");
    if (!res.ok) return;
    studyTimes = await res.json();
    render();
  } catch {
    // offline or server restarting: keep what's shown
  }
}

async function removeClass(c) {
  if (!confirm("Remove " + c.name + " from every day it's on?")) return;
  const res = await fetch("/api/classes/" + c.id, { method: "DELETE" });
  if (res.status === 401) return (window.location.href = "/");
  classes = classes.filter((x) => x.id !== c.id);
  if (editingId === c.id) stopEditing(); // deleted the item being edited
  render();
  loadStudyTimes();
}

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = document.getElementById("form-error");
  error.textContent = "";

  const kind = document.getElementById("kind").value;
  const isAsync = isAsyncChosen();
  const newClass = {
    kind,
    async: isAsync,
    category: kind === "other" ? document.getElementById("category").value.trim() : "",
    name: document.getElementById("name").value.trim(),
    start: isAsync ? null : document.getElementById("start").value,
    end: isAsync ? null : document.getElementById("end").value,
    location: kind === "class" ? document.getElementById("location").value.trim() : "",
    days: DAYS.map(([key]) => key).filter((key) => document.getElementById("day-" + key).checked),
  };
  // Picked a section from the class schedule? The server saves its real times (and any second time block)
  const section = !editingId && kind === "class" && window.coursePicker ? window.coursePicker.sectionFor(newClass.name) : "";
  if (section) newClass.section = section;

  if (kind === "other" && !newClass.category) return (error.textContent = "Say what it is (e.g. Work).");
  if (!isAsync && newClass.days.length === 0) return (error.textContent = "Pick at least one day.");
  if (!isAsync && newClass.end <= newClass.start) return (error.textContent = "End time must be after the start time.");

  // Editing → PUT to /api/classes/<id>; adding → POST to /api/classes
  const res = await fetch(editingId ? "/api/classes/" + editingId : "/api/classes", {
    method: editingId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newClass),
  });
  if (res.status === 401) return (window.location.href = "/");
  const data = await res.json();
  if (!res.ok) return (error.textContent = data.error || "Couldn't save that class.");

  if (editingId) {
    classes = classes.map((x) => (x.id === editingId ? data : x));
    stopEditing();
    render();
    loadStudyTimes();
    return;
  }

  const { extra = [], ...saved } = data; // extra: the section's other time blocks, also saved
  classes.push(saved, ...extra);
  render();
  loadStudyTimes();
  e.target.reset();
  updateFormForAsync(); // reset() unticks async, so bring the time fields back
  document.getElementById("name").focus();
});

document.getElementById("edit-cancel").addEventListener("click", stopEditing);

// "+ Add" next to "Your week" → open the Add form
document.getElementById("add-open").addEventListener("click", () => {
  if (editingId) stopEditing();
  showAddForm();
});

document.getElementById("kind").addEventListener("change", updateFormForKind);
document.getElementById("async").addEventListener("change", updateFormForAsync);
updateFormForKind();
paintColorKey();
loadClasses();
