// StudySync - landing page (runs in the browser).
// Studying alone → free times in your week to set aside for studying.
// Studying with a group → the group they were matched into automatically (or a "you're one of the first" note).

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

// ---------- On my own: study times that add up to the weekly goal ----------
// The server plans them (studyplan.js): the AI if there's an API key, otherwise the
// calm-times algorithm in public/planner.js.

async function loadStudyPlan() {
  $("study-total").textContent = "Planning your week…";
  const res = await fetch("/api/study-plan");
  if (!res.ok) return showLoadError();
  renderStudyTimes(await res.json());
}

function renderStudyTimes(plan) {
  const week = $("study-times");
  week.innerHTML = "";
  const todayKey = DAYS[(new Date().getDay() + 6) % 7][0]; // JS weeks start on Sunday

  for (const [key, label] of DAYS) {
    const col = document.createElement("div");
    col.className = "study-day" + (key === todayKey ? " today" : "");
    const title = document.createElement("h3");
    title.textContent = label;
    col.appendChild(title);

    const sessions = plan.sessions.filter((s) => s.day === key);
    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.innerHTML = '<span class="empty-icon" aria-hidden="true">🌿</span>Rest day';
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
      col.appendChild(card);
    }
    week.appendChild(col);
  }

  const goal = plan.goalMinutes;
  $("study-total").textContent = plan.found >= goal
    ? "Here's your " + formatLength(goal) + " for the week" + (plan.source === "ai" ? ", planned around your notes." : ", in the calmest times you're free.")
    : "Your week is pretty full: we could only find " + (plan.found ? formatLength(plan.found) : "no free time") +
      " of your " + formatLength(goal) + " goal. Try a smaller goal, or check your schedule.";
}

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

// ---------- With a group: matched automatically ----------

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
  const res = await fetch("/api/groups/match", { method: "POST" });
  if (!res.ok) return showLoadError();
  groups = await res.json();
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
  const waiting = groupsLoaded && groups.length === 0;
  $("group-view").hidden = preference !== "group";
  $("my-groups").hidden = waiting;
  $("group-waiting").hidden = !waiting;
  // Solo study times: for "alone", and for "group" while waiting for a match
  $("alone-view").hidden = preference === "group" && !waiting;
  $("alone-heading").textContent = preference === "group"
    ? "In the meantime: times to study on your own"
    : "Times to set aside for studying";
  const radio = document.querySelector('input[name="preference"][value="' + preference + '"]');
  if (radio) radio.checked = true;
}

for (const radio of document.querySelectorAll('input[name="preference"]')) {
  radio.addEventListener("change", async () => {
    // Switching to "alone" takes you out of your study group; switching back re-matches you
    preference = radio.value;
    updateViews();
    // Save it. The server re-matches: joins a group (group) or leaves it (alone).
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference }),
    }).catch(() => {});
    await loadGroups();
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
  fillGoalPicker();
  updateViews();
  await Promise.all([loadStudyPlan(), loadGroups()]);
}
load();
