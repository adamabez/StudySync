// StudySync - first-login setup screen (runs in the browser).
// Step 1: add classes and other commitments (saved with the same /api/classes routes
// as the dashboard). Step 2: study alone or in a group? Step 3: hours a week. Finish → /landing.

const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
let items = []; // what's on the user's calendar so far

const $ = (id) => document.getElementById(id);
const chosenKind = () => document.querySelector('input[name="kind"]:checked').value;
const isAsyncChosen = () => chosenKind() === "class" && $("async").checked;

// Turn "14:30" into "2:30 PM"
function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ampm;
}

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

function renderList() {
  const list = $("added-list");
  list.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "added-empty";
    empty.textContent = "Nothing added yet.";
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "added-item " + (item.kind || "class");

    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.textContent = describe(item) + (item.location ? " · " + item.location : "") + (item.category ? " · " + item.category : "");
    text.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button danger";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove " + item.name);
    remove.addEventListener("click", () => removeItem(item));

    li.append(text, remove);
    list.appendChild(li);
  }
}

async function removeItem(item) {
  const res = await fetch("/api/classes/" + item.id, { method: "DELETE" });
  if (!res.ok) return alert("Couldn't remove that. Try again.");
  items = items.filter((i) => i.id !== item.id);
  renderList();
}

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = chosenKind();
  const body = {
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
  renderList();
  // Clear the name (keep the days and times: the next class is often similar)
  $("name").value = "";
  $("location").value = "";
  $("form-error").textContent = "";
  $("name").focus();
});

for (const radio of document.querySelectorAll('input[name="kind"]')) radio.addEventListener("change", updateForm);
$("async").addEventListener("change", updateForm);

$("finish").addEventListener("click", async () => {
  const picked = document.querySelector('input[name="preference"]:checked');
  if (!picked) {
    $("finish-error").textContent = "Pick whether you'd rather study on your own or with a group.";
    return;
  }
  const weeklyHours = chosenHours();
  if (!Number.isInteger(weeklyHours) || weeklyHours < 1 || weeklyHours > 40) {
    $("finish-error").textContent = "Pick between 1 and 40 hours a week to study.";
    return;
  }
  $("finish").disabled = true;
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preference: picked.value, weeklyHours, studyNotes: $("study-notes").value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    $("finish-error").textContent = data.error || "Couldn't save. Try again.";
    $("finish").disabled = false;
    return;
  }
  window.location.href = "/landing";
});

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
    // Study notes only matter when the AI plans study times
    $("notes-field").hidden = !profile.aiScheduling;
    $("study-notes").value = profile.studyNotes || "";
    if (profile.onboarded) $("finish").textContent = "Save";
  }
}
load();
