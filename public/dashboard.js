// StudySync - dashboard calendar (runs in the browser, not on the server).
// Talks to the server's /api/classes routes to load, add and remove classes.

const DAYS = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
  ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
];
let classes = []; // everything on the calendar: classes, tasks and "other" items

// What the "Add a…" dropdown changes for each choice
const KINDS = {
  class: { nameLabel: "Class name", placeholder: "e.g. Biology 101", button: "Add class" },
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
  document.getElementById("add-button").textContent = k.button;
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

    const todays = classes
      .filter((c) => c.days.includes(key))
      .sort((a, b) => (a.start || "").localeCompare(b.start || "")); // async (no time) first

    if (todays.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Nothing planned";
      col.appendChild(empty);
    }

    for (const c of todays) col.appendChild(makeCard(c));
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

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.title = "Remove " + c.name;
  remove.setAttribute("aria-label", "Remove " + c.name);
  remove.textContent = "×";
  remove.onclick = () => removeClass(c);

  card.append(name, meta, remove);
  return card;
}

async function loadClasses() {
  const res = await fetch("/api/classes");
  if (res.status === 401) return (window.location.href = "/");
  classes = await res.json();
  render();
}

async function removeClass(c) {
  if (!confirm("Remove " + c.name + " from every day it's on?")) return;
  const res = await fetch("/api/classes/" + c.id, { method: "DELETE" });
  if (res.status === 401) return (window.location.href = "/");
  classes = classes.filter((x) => x.id !== c.id);
  render();
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

  if (kind === "other" && !newClass.category) return (error.textContent = "Say what it is (e.g. Work).");
  if (!isAsync && newClass.days.length === 0) return (error.textContent = "Pick at least one day.");
  if (!isAsync && newClass.end <= newClass.start) return (error.textContent = "End time must be after the start time.");

  const res = await fetch("/api/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newClass),
  });
  if (res.status === 401) return (window.location.href = "/");
  const data = await res.json();
  if (!res.ok) return (error.textContent = data.error || "Couldn't save that class.");

  classes.push(data);
  render();
  e.target.reset();
  updateFormForAsync(); // reset() unticks async, so bring the time fields back
  document.getElementById("name").focus();
});

document.getElementById("kind").addEventListener("change", updateFormForKind);
document.getElementById("async").addEventListener("change", updateFormForAsync);
updateFormForKind();
paintColorKey();
loadClasses();
