// StudySync - landing page (runs in the browser).
// Studying alone → free times in your week to set aside for studying.
// Group → the group they were matched into automatically (or a "you're one of the first" note).

const DAYS = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
  ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
];
const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

const GOAL_OPTIONS = [2, 4, 6, 8, 10, 15]; // hours a week to pick from (same as the setup screen)

let calendar = [];
let groups = [];
let groupsLoaded = false; // false until the first match check finishes
let weeklyHours = 6;      // study goal, from the profile
let sessionLength = "medium"; // short / medium / long study sessions, from the profile
const LENGTH_HINTS = {
  short: "Short 30–45 minute sessions, spread over as many days as we can.",
  medium: "Sessions are 45–90 minutes, spread across the week.",
  long: "Long 1.5–2 hour sessions for deep focus.",
};

const $ = (id) => document.getElementById(id);

// ---------- Time helpers ----------
const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Turn "14:30" into "2:30 PM"
function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ampm;
}

function formatLength(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (h ? h + "h" : "") + (h && m ? " " : "") + (m ? m + "m" : "");
}

// ---------- Solo: study times that add up to the weekly goal ----------
// The server plans them (studyplan.js): the AI if there's an API key, otherwise the
// calm-times algorithm in public/planner.js.

async function loadStudyPlan() {
  $("study-total").textContent = "";
  $("study-loading").hidden = false;
  showPlanLoading();
  const [res] = await Promise.all([fetch("/api/study-plan"), window.studyLog.load()]).finally(() => { $("study-loading").hidden = true; });
  if (!res.ok) return showLoadError();
  renderStudyTimes(await res.json());
}

// Progress bar at the top: time checked off this week toward the weekly goal (study-log.js).
// Its sessions are the group meetings when in a group, otherwise the solo plan.
let shownSessions = [];
window.studyLog.progress.mount($("week-progress"));
let soloLeft = null; // solo minutes still to plan after group meetings (null until the plan loads)
function updatePlanned() {
  // Group meetings (when in a group) plus the solo sessions
  const meetings = preference === "group" && groups.length
    ? groups.flatMap((g) => (g.days || []).map((day) => ({ day, start: g.start, end: g.end, kind: "group" }))).filter((s) => s.start && s.end)
    : [];
  window.studyLog.progress.setPlanned([...meetings, ...shownSessions]);
}

// While the plan loads: each day gets a shimmering placeholder, so it doesn't look empty
function showPlanLoading() {
  const week = $("study-times");
  if (week.querySelector(".study-block")) { week.classList.add("refreshing"); return; } // keep the old plan, dimmed
  week.innerHTML = "";
  for (const [, label] of DAYS) {
    const col = document.createElement("div");
    col.className = "study-day";
    const title = document.createElement("h3");
    title.textContent = label;
    const ghost = document.createElement("div");
    ghost.className = "study-ghost";
    ghost.setAttribute("aria-hidden", "true");
    col.append(title, ghost);
    week.appendChild(col);
  }
  week.setAttribute("aria-busy", "true");
}

function renderStudyTimes(plan) {
  const week = $("study-times");
  week.innerHTML = "";
  week.classList.remove("refreshing");
  week.removeAttribute("aria-busy");
  window.studyLog.clearButtons();
  shownSessions = plan.sessions;
  soloLeft = plan.goalMinutes;
  // The bar counts toward the whole weekly goal (group meetings + solo)
  window.studyLog.progress.setGoal(plan.weeklyGoalMinutes || plan.goalMinutes);
  updatePlanned();
  const todayKey = DAYS[(new Date().getDay() + 6) % 7][0]; // JS weeks start on Sunday

  for (const [key, label] of DAYS) {
    const col = document.createElement("div");
    col.className = "study-day" + (key === todayKey ? " today" : "");
    const title = document.createElement("h3");
    title.textContent = label;
    col.appendChild(title);

    const sessions = plan.sessions.filter((s) => s.day === key);
    if (sessions.length === 0) {
      // No study time this day: say why (classes, the gym) or that it's a rest day (day-emoji.js)
      const { classes, workout } = window.dayEmoji.of(window.studyDates.thisWeek(calendar), key);
      const [icon, text] = classes && workout ? ["📚 🏋️", "Classes + gym"]
        : classes ? ["📚", "Class day"]
        : workout ? ["🏋️", "Gym day"]
        : [window.dayEmoji.rest(key), "Rest day"];
      const empty = document.createElement("p");
      empty.className = "empty";
      const emoji = document.createElement("span");
      emoji.className = "empty-icon";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = icon;
      empty.append(emoji, text);
      col.appendChild(empty);
    }
    for (const session of sessions) {
      const card = document.createElement("div");
      card.className = "study-block";
      card.title = "Planned for you by StudySync";
      const sparkle = document.createElement("span");
      sparkle.className = "study-sparkle";
      sparkle.setAttribute("aria-hidden", "true");
      sparkle.textContent = "✦";
      card.appendChild(sparkle);
      const time = document.createElement("strong");
      time.textContent = formatTime(session.start) + " – " + formatTime(session.end);
      const meta = document.createElement("span");
      meta.textContent = session.label + " · " + formatLength(toMinutes(session.end) - toMinutes(session.start));
      card.append(time, meta);
      if (session.reason) {
        const reason = document.createElement("span");
        reason.className = "study-reason";
        reason.textContent = session.reason;
        card.appendChild(reason);
      }
      if (window.studyLog.ready) card.appendChild(window.studyLog.button(session));
      // ✎: move, change length or skip this week (study-edit.js)
      if (plan.editable && session.key) {
        card.classList.add("has-edit");
        card.appendChild(window.studyEdit.button(session, loadStudyPlan));
      }
      if (session.edited) {
        card.classList.add("edited");
        card.title = "You changed this one";
      }
      col.appendChild(card);
    }
    week.appendChild(col);
  }

  updateViews();
  showSplit(plan);
  window.studyEdit.skippedNote($("skipped-note"), plan.skipped || [], loadStudyPlan);
}

// The weekly goal as a little bar: group meetings (blue) + solo sessions (teal) + anything
// that didn't fit (striped). A short note only when the week was too full.
function showSplit(plan) {
  const weekly = plan.weeklyGoalMinutes || plan.goalMinutes;
  const group = Math.min(plan.groupMinutes || 0, weekly);
  const solo = Math.min(plan.found || 0, Math.max(0, weekly - group));
  // Time the planner couldn't place vs time the student skipped or shortened with ✎
  const suggested = Math.min(plan.suggestedFound ?? plan.found ?? 0, Math.max(0, weekly - group));
  const missing = Math.max(0, weekly - group - Math.max(suggested, solo));
  const skipped = Math.max(0, weekly - group - solo - missing);
  const box = $("plan-split");
  box.hidden = !weekly;
  if (!weekly) return;
  const pct = (min) => (min / weekly) * 100 + "%";
  box.querySelector(".seg-group").style.width = pct(group);
  box.querySelector(".seg-solo").style.width = pct(solo);
  box.querySelector(".seg-skipped").style.width = pct(skipped);
  box.querySelector(".seg-missing").style.width = pct(missing);

  const key = box.querySelector(".plan-split-key");
  key.innerHTML = "";
  const item = (cls, text) => {
    const span = document.createElement("span");
    span.className = "key " + cls;
    span.textContent = text;
    key.appendChild(span);
  };
  if (group) item("key-group", "Group " + formatLength(group));
  if (solo) item("key-solo", "Solo " + formatLength(solo));
  if (skipped) item("key-skipped", "Skipped " + formatLength(skipped));
  if (missing) item("key-missing", "Didn't fit " + formatLength(missing));
  const total = document.createElement("span");
  total.className = "key-total";
  total.textContent = formatLength(weekly) + " goal";
  key.appendChild(total);

  $("study-total").textContent = missing
    ? "Your week is pretty full. Try a smaller goal, or check your schedule."
    : "";
  $("study-total").hidden = !missing;
}

// Session length dropdown: short sessions spread out more, long ones are fewer and deeper
function showLength() {
  $("length-select").value = sessionLength;
  $("length-hint").textContent = LENGTH_HINTS[sessionLength] || LENGTH_HINTS.medium;
}

$("length-select").addEventListener("change", async () => {
  const before = sessionLength;
  sessionLength = $("length-select").value;
  showLength();
  $("length-error").hidden = true;
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionLength }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) : {};
    sessionLength = before;
    showLength();
    $("length-error").textContent = data.error || "Couldn't save that. Try again.";
    $("length-error").hidden = false;
    return;
  }
  await loadStudyPlan();
});

// The weekly goal dropdown above the study times
function fillGoalPicker() {
  const select = $("goal-select");
  select.innerHTML = "";
  const options = GOAL_OPTIONS.includes(weeklyHours) ? GOAL_OPTIONS : [...GOAL_OPTIONS, weeklyHours].sort((a, b) => a - b);
  for (const hours of options) {
    const option = document.createElement("option");
    option.value = hours;
    option.textContent = hours + " hours a week";
    option.selected = hours === weeklyHours;
    select.appendChild(option);
  }
}

$("goal-select").addEventListener("change", async () => {
  weeklyHours = Number($("goal-select").value);
  // Save the new goal first, then re-plan with it
  await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weeklyHours }),
  }).catch(() => {});
  await loadStudyPlan();
});

// ---------- Group: matched automatically ----------

function describeGroup(group) {
  return "Meets " + group.days.map((d) => DAY_SHORT[d]).join(", ") + " · " + formatTime(group.start) + " – " + formatTime(group.end);
}

function groupCard(group) {
  // The whole card opens the group's page (members + shared notes)
  const card = document.createElement("a");
  card.className = "group-card";
  card.href = "/group?id=" + encodeURIComponent(group.id);

  const name = document.createElement("strong");
  name.className = "group-name";
  name.textContent = group.name;
  card.appendChild(name);

  const when = document.createElement("span");
  when.className = "meta";
  when.textContent = describeGroup(group);
  card.appendChild(when);

  const list = document.createElement("ul");
  list.className = "member-list";
  for (const member of group.members) {
    const li = document.createElement("li");
    li.textContent = member.name + (member.isYou ? " (you)" : "");
    list.appendChild(li);
  }
  card.appendChild(list);

  // Everyone else left (e.g. their schedule changed): more people get added automatically
  if (group.members.length < 2) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Your other group members' schedules changed. We'll add new people as soon as their schedules fit.";
    card.appendChild(note);
  }

  const open = document.createElement("span");
  open.className = "group-open";
  open.textContent = "Open group notes →";
  card.appendChild(open);
  return card;
}

// Try to match the student, then show their group (or the "one of the first" message)
async function loadGroups() {
  const [res] = await Promise.all([fetch("/api/groups/match", { method: "POST" }), window.studyLog.load()]);
  if (!res.ok) return showLoadError();
  groups = await res.json();
  updatePlanned();
  groupsLoaded = true;

  const box = $("my-groups");
  box.innerHTML = "";
  for (const group of groups) box.appendChild(groupCard(group));
  updateViews();
  await showWaitingClasses();
}

// Classes that don't have a group yet: "Still looking for study partners in PHYS 11A"
async function showWaitingClasses() {
  let classes = [];
  try {
    const res = await fetch("/api/groups/classes");
    if (res.ok) classes = await res.json();
  } catch {
    // leave it out
  }
  const waiting = classes.filter((c) => !c.hasGroup).map((c) => c.label);
  const text = waiting.length
    ? "Still looking for study partners in " + joinList(waiting) + ". We'll add you as soon as a classmate's schedule fits."
    : "";
  $("still-looking").textContent = text;
  $("still-looking").hidden = !text || groups.length === 0;
  $("waiting-classes").textContent = waiting.length ? "Your classes: " + joinList(classes.map((c) => c.label)) + "." : "";
  $("waiting-classes").hidden = !waiting.length;
}

// ["A", "B", "C"] → "A, B and C"
function joinList(items) {
  return items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// ---------- Switching between alone and group ----------

let preference = "alone";

function updateViews() {
  updatePlanned();
  const waiting = groupsLoaded && groups.length === 0;
  $("group-view").hidden = preference !== "group";
  $("my-groups").hidden = waiting;
  $("group-waiting").hidden = !waiting;
  // Solo study times: always for Solo; for Group, the rest of the weekly goal after the
  // group meetings (or all of it while waiting for a match)
  const fillGoal = preference === "group" && !waiting;
  $("alone-view").hidden = fillGoal && soloLeft === 0;
  $("alone-heading").textContent = preference !== "group" ? "Times to set aside for studying"
    : fillGoal ? "Solo time to round out your week"
    : "In the meantime: times to study on your own";
  $("solo-hero").hidden = preference === "group";
  // Session length is a solo feature: group meetings are set for the whole group
  $("length-picker").hidden = preference === "group";
  $("length-hint").hidden = preference === "group";
  $("pref-result-text").textContent = preference === "group"
    ? "Group: we match you with classmates in each class and schedule a weekly session when everyone's free."
    : "Solo: we set aside study sessions in your free time to reach your weekly goal.";
  const radio = document.querySelector('input[name="preference"][value="' + preference + '"]');
  if (radio) radio.checked = true;
}

// "✓ Saved" next to the explanation for a moment after switching
let savedTimer = null;
function flashSaved() {
  $("pref-saved").hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $("pref-saved").hidden = true; }, 2500);
}

for (const radio of document.querySelectorAll('input[name="preference"]')) {
  radio.addEventListener("change", async () => {
    // Switching to "alone" takes you out of your study group; switching back re-matches you
    preference = radio.value;
    updateViews();
    // Save it. The server re-matches: joins a group (group) or leaves it (alone).
    const saved = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference }),
    }).then((res) => res.ok).catch(() => false);
    if (saved) flashSaved();
    await loadGroups();
    await loadStudyPlan(); // group meetings count toward the goal, so the solo part changes
  });
}

function showLoadError() {
  $("load-error").textContent = "Couldn't load your study plan. Refresh the page to try again.";
  $("load-error").hidden = false;
}

// ---------- Start ----------
async function load() {
  const [profileRes, classesRes, meRes] = await Promise.all([fetch("/api/profile"), fetch("/api/classes"), fetch("/api/me")]);
  if (!profileRes.ok || !classesRes.ok) return showLoadError();
  const profile = await profileRes.json();
  calendar = await classesRes.json();
  if (meRes.ok) {
    const me = await meRes.json();
    if (me.email) $("greeting").textContent = "Logged in as " + me.email;
  }

  $("no-schedule").hidden = calendar.some((item) => item.start);
  preference = profile.preference || "alone";
  weeklyHours = profile.weeklyHours || 6;
  window.studyLog.progress.setGoal(weeklyHours * 60);
  sessionLength = profile.sessionLength || "medium";
  fillGoalPicker();
  showLength();
  updateViews();
  await Promise.all([loadStudyPlan(), loadGroups()]);
}
load();
