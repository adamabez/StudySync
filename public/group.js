// StudySync - one study group's page (runs in the browser): who's in it, when it meets,
// the next session (who's coming, moving it, where), and the notes members share with each other.

const { DAY_SHORT, formatTime } = window.studyFormat; // public/format.js
const $ = (id) => document.getElementById(id);
const groupId = new URLSearchParams(location.search).get("id") || "";

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function showError(message) {
  $("load-error").textContent = message;
  $("load-error").hidden = false;
}

// ---------- Discord server link ----------
// From the server: { url, name, iconUrl, members, online, expired }, or null for no link
let discord = null;

// Read the server's answer. Older servers sent just { discordUrl }; treat that as a link
// with no server details, so the Join button still shows.
function discordFrom(data) {
  if (data && data.discord !== undefined) return data.discord || null;
  const url = data && data.discordUrl;
  return url ? { url, name: "", iconUrl: "", members: null, online: null, expired: false } : null;
}

// "Study Buddies CSC" → "SB" (shown when the server has no icon, like Discord does)
function initials(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => [...w][0]).join("").toUpperCase() || "?";
}

function renderDiscordCard() {
  const name = discord.name || "Class chat on Discord";
  $("discord-name").textContent = name;
  $("discord-link").href = discord.url;
  // Only when we know the server's ID (from Discord's invite lookup) and the invite still works
  const canOpen = /^\d{5,25}$/.test(discord.guildId || "") && !discord.expired;
  $("discord-open").hidden = !canOpen;
  if (canOpen) $("discord-open").href = "https://discord.com/channels/" + discord.guildId;

  const icon = $("discord-icon");
  icon.hidden = !discord.iconUrl;
  $("discord-initials").hidden = Boolean(discord.iconUrl);
  // Initials if we know the name; otherwise Discord's logo (better than a "?")
  const badge = $("discord-initials");
  badge.textContent = discord.name ? initials(discord.name) : "";
  if (!discord.name) {
    const mark = document.createElement("img");
    mark.src = "/public/discord-mark-white.svg";
    mark.alt = "";
    mark.className = "discord-initials-mark";
    badge.appendChild(mark);
  }
  if (discord.iconUrl) {
    icon.src = discord.iconUrl;
    icon.onerror = () => { icon.hidden = true; $("discord-initials").hidden = false; };
  }

  const counts = [];
  if (discord.members != null) counts.push(discord.members.toLocaleString() + (discord.members === 1 ? " member" : " members"));
  if (discord.online != null) counts.push(discord.online.toLocaleString() + " online");
  $("discord-counts").innerHTML = "";
  if (discord.online != null) {
    const dot = document.createElement("span");
    dot.className = "discord-online-dot";
    $("discord-counts").appendChild(dot);
  }
  $("discord-counts").append(counts.join(" · "));
  $("discord-counts").hidden = counts.length === 0;
  $("discord-expired").hidden = !discord.expired;
}

function renderDiscord(editing = false) {
  const has = Boolean(discord);
  $("discord-view").hidden = !has || editing;
  $("discord-empty").hidden = has || editing;
  $("discord-form").hidden = has && !editing;
  $("discord-cancel").hidden = !has;
  $("discord-save").textContent = has ? "Save" : "Add link";
  if (has) renderDiscordCard();
  $("discord-error").hidden = true;
}

async function saveDiscord(value) {
  $("discord-error").hidden = true;
  const res = await fetch("/api/groups/" + groupId + "/discord", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discordUrl: value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("discord-error").textContent = data.error || "Couldn't save the link. Try again.";
    $("discord-error").hidden = false;
    return;
  }
  discord = discordFrom(data);
  $("discord-input").value = "";
  renderDiscord();
}

$("discord-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!$("discord-input").value.trim()) return;
  $("discord-save").disabled = true;
  try { await saveDiscord($("discord-input").value); } finally { $("discord-save").disabled = false; }
});
$("discord-edit").addEventListener("click", () => {
  $("discord-input").value = discord ? discord.url : "";
  renderDiscord(true);
  $("discord-input").focus();
});
$("discord-cancel").addEventListener("click", () => renderDiscord());
$("discord-remove").addEventListener("click", async () => {
  if (!confirm("Remove the class chat link for everyone in this class? (The Discord server itself stays.)")) return;
  await saveDiscord("");
});

function renderGroup(group) {
  document.title = "StudySync – " + group.name;
  $("group-name").textContent = group.name;
  $("group-when").textContent = "Meets " + group.days.map((d) => DAY_SHORT[d]).join(", ") +
    " · " + formatTime(group.start) + " – " + formatTime(group.end);

  const list = $("group-members");
  list.innerHTML = "";
  for (const member of group.members) {
    const li = document.createElement("li");
    li.textContent = member.name + (member.isYou ? " (you)" : "");
    list.appendChild(li);
  }
}

function noteCard(note) {
  const card = document.createElement("article");
  card.className = "note-card";

  const head = document.createElement("div");
  head.className = "note-head";
  const title = document.createElement("strong");
  title.textContent = note.title;
  head.appendChild(title);

  if (note.isYours) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this note for everyone in the group?")) return;
      const res = await fetch("/api/groups/" + groupId + "/notes/" + note.id, { method: "DELETE" });
      if (res.ok) card.remove();
      updateEmpty();
    });
    head.appendChild(remove);
  }
  card.appendChild(head);

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = (note.isYours ? "You" : note.author) + " · " + formatDate(note.createdAt);
  card.appendChild(meta);

  const body = document.createElement("p");
  body.className = "note-body";
  body.textContent = note.body;
  card.appendChild(body);
  return card;
}

function updateEmpty() {
  $("notes-empty").hidden = $("notes").children.length > 0;
}

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("note-error").hidden = true;
  $("note-submit").disabled = true;
  try {
    const res = await fetch("/api/groups/" + groupId + "/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: $("note-title").value, body: $("note-body").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't save the note. Try again.");
    $("notes").prepend(noteCard(data));
    $("note-form").reset();
    updateEmpty();
  } catch (error) {
    $("note-error").textContent = error.message;
    $("note-error").hidden = false;
  } finally {
    $("note-submit").disabled = false;
  }
});

// ---------- Meeting up: the next session, RSVPs, moving it, and where (meetups.js on the server) ----------
// The goal: a group can go from matched to meeting without messaging anyone.
let currentGroup = null;
let info = null; // { meetup, spots, rsvps, moves } from the server

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const atTime = (date, hhmm) => new Date(`${date}T${hhmm}:00`); // local time
const dayKeyOf = (date) => Object.keys(DAY_INDEX).find((k) => DAY_INDEX[k] === atTime(date, "12:00").getDay());

const whenText = (group) => group.days.map((d) => DAY_SHORT[d]).join(", ") + " · " +
  formatTime(group.start) + " – " + formatTime(group.end);

function prettyDate(date) {
  const d = atTime(date, "12:00");
  return DAY_LONG[d.getDay()] + ", " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "Today", "Tomorrow", "In 3 days"
function soonText(date) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((atTime(date, "12:00") - today) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? "" : `In ${days} days`;
}

// The group's weekly sessions around now, with any one-off moves applied, soonest first
function upcomingSessions() {
  const now = new Date();
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const list = [];
  for (let i = -7; i <= 14; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const usual = ymd(d);
    if (!currentGroup.days.includes(dayKeyOf(usual))) continue;
    const move = info.moves.find((m) => m.sessionDate === usual);
    const date = move ? move.date : usual;
    const start = move ? move.start : currentGroup.start;
    const end = move ? move.end : currentGroup.end;
    list.push({ sessionDate: usual, date, start, end, move, startsAt: atTime(date, start), endsAt: atTime(date, end) });
  }
  return list.filter((s) => s.endsAt > now).sort((a, b) => a.startsAt - b.startsAt);
}

function showNote(id, text) {
  $(id).textContent = text || "";
  $(id).hidden = !text;
}

// Send a change; the server answers with the fresh meetup info
async function meetupRequest(path, method = "POST", body) {
  const res = await fetch("/api/groups/" + encodeURIComponent(groupId) + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = "/"; throw new Error("Not logged in"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.notSetUp) notSetUp(data.error);
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return data;
}

function notSetUp(message) {
  $("next-card").innerHTML = "";
  $("meet-status").innerHTML = "";
  $("meet-ideas").hidden = true;
  showNote("next-error", message);
}

function renderAll() {
  renderNext();
  renderMeetup();
}

// ----- Next session: when and where, RSVPs, who's coming -----
const STATUS = {
  going: { label: "Going", icon: "✓" },
  late: { label: "Running late", icon: "⏱" },
  cant: { label: "Can't make it", icon: "✕" },
};

let picker = null; // open "find another time" list: { sessionDate } or null

function renderNext() {
  const card = $("next-card");
  card.innerHTML = "";
  const session = upcomingSessions()[0];
  if (!session) {
    card.innerHTML = '<p class="hint">No upcoming session found.</p>';
    return;
  }
  openChat(session.sessionDate);
  const answers = info.rsvps.filter((r) => r.sessionDate === session.sessionDate);
  const mine = answers.find((r) => r.isYou)?.status || null;
  const now = new Date();
  const live = session.startsAt <= now && now < session.endsAt;

  // Which class and group it's for: "CSC 130 · Group A" (names look like "CSC 130 | Group A")
  if (currentGroup) {
    const [beforeBar, afterBar] = currentGroup.name.split(" | ");
    const course = currentGroup.course || (afterBar ? beforeBar : "");
    const groupLabel = afterBar || currentGroup.name;
    const forLine = document.createElement("div");
    forLine.className = "ns-for";
    if (course) {
      const cls = document.createElement("span");
      cls.className = "ns-class";
      cls.textContent = course;
      forLine.appendChild(cls);
    }
    const grp = document.createElement("span");
    grp.className = "ns-group";
    grp.textContent = groupLabel;
    forLine.appendChild(grp);
    card.appendChild(forLine);
  }

  // When + where
  const head = document.createElement("div");
  head.className = "ns-head";
  head.innerHTML = `<div class="ns-when">
      <span class="ns-soon${live ? " live" : ""}"></span>
      <strong class="ns-date"></strong>
      <span class="ns-time"></span>
    </div>
    <div class="ns-where"><span aria-hidden="true">📍</span><span class="ns-place"></span></div>`;
  head.querySelector(".ns-soon").textContent = live ? "Happening now" : soonText(session.date);
  head.querySelector(".ns-date").textContent = prettyDate(session.date);
  head.querySelector(".ns-time").textContent = formatTime(session.start) + " – " + formatTime(session.end);
  const place = head.querySelector(".ns-place");
  if (info.meetup) place.textContent = info.meetup.place;
  else {
    place.textContent = "No spot picked yet";
    place.classList.add("none");
  }
  card.appendChild(head);

  if (session.move) {
    const moved = document.createElement("p");
    moved.className = "ns-moved";
    moved.textContent = `Moved this week by ${session.move.movedBy}. It's usually ${DAY_SHORT[dayKeyOf(session.sessionDate)]} ${formatTime(currentGroup.start)}. `;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "link-button";
    undo.textContent = "Put it back";
    undo.addEventListener("click", async () => {
      if (!confirm("Move this session back to its usual time?")) return;
      await act(() => meetupRequest("/move?session=" + session.sessionDate, "DELETE"));
    });
    moved.appendChild(undo);
    card.appendChild(moved);
  }

  // Your answer
  const rsvp = document.createElement("div");
  rsvp.className = "ns-rsvp";
  rsvp.setAttribute("role", "group");
  rsvp.setAttribute("aria-label", "Are you coming?");
  for (const [key, s] of Object.entries(STATUS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ns-choice ${key}`;
    b.setAttribute("aria-pressed", String(mine === key));
    b.innerHTML = `<span aria-hidden="true">${s.icon}</span> ${s.label}`;
    b.addEventListener("click", async () => {
      const status = mine === key ? null : key; // tap again to take it back
      await act(() => meetupRequest("/rsvp", "POST", { sessionDate: session.sessionDate, status }));
      if (status === "cant") picker = { sessionDate: session.sessionDate };
      renderNext();
    });
    rsvp.appendChild(b);
  }
  card.appendChild(rsvp);

  // Who's coming
  const counts = { going: 0, late: 0, cant: 0, none: 0 };
  const people = document.createElement("ul");
  people.className = "ns-people";
  for (const member of currentGroup.members) {
    const status = answers.find((r) => (member.isYou ? r.isYou : r.name === member.name && !r.isYou))?.status || "none";
    counts[status]++;
    const li = document.createElement("li");
    li.className = "ns-person " + status;
    li.innerHTML = '<span class="ns-name"></span><span class="ns-status"></span>';
    li.querySelector(".ns-name").textContent = member.isYou ? "You" : member.name;
    li.querySelector(".ns-status").textContent = status === "none" ? "No answer yet" : STATUS[status].label;
    people.appendChild(li);
  }
  const summary = document.createElement("p");
  summary.className = "ns-summary";
  summary.textContent = [
    counts.going && `${counts.going} going`,
    counts.late && `${counts.late} running late`,
    counts.cant && `${counts.cant} can't make it`,
    counts.none && `${counts.none} haven't answered`,
  ].filter(Boolean).join(" · ");
  card.append(summary, people);

  // Can't make it? Find a time that works for everyone
  const cantNames = answers.filter((r) => r.status === "cant").map((r) => (r.isYou ? "You" : r.name));
  const move = document.createElement("div");
  move.className = "ns-move" + (cantNames.length ? " needed" : "");
  const prompt = document.createElement("p");
  prompt.textContent = cantNames.length
    ? `${cantNames.join(" and ")} can't make this one. Want to move it?`
    : "This time doesn't work this week?";
  const find = document.createElement("button");
  find.type = "button";
  find.className = cantNames.length ? "ns-find primary" : "ns-find";
  find.textContent = "Find a time that works for everyone";
  find.addEventListener("click", () => {
    picker = picker ? null : { sessionDate: session.sessionDate };
    renderNext();
  });
  move.append(prompt, find);
  card.appendChild(move);

  if (picker && picker.sessionDate === session.sessionDate) {
    const box = document.createElement("div");
    box.className = "ns-times";
    box.innerHTML = '<p class="hint">Checking everyone\'s schedules…</p>';
    card.appendChild(box);
    loadTimes(session, box);
  }
}

// Times in the next week when every member is free, as buttons
async function loadTimes(session, box) {
  let slots;
  try {
    slots = await meetupRequest("/slots", "GET");
  } catch (e) {
    box.innerHTML = "";
    showNote("next-error", e.message);
    return;
  }
  const now = new Date();
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const options = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const date = ymd(d);
    const day = dayKeyOf(date);
    for (const slot of slots.filter((x) => x.day === day)) {
      if (atTime(date, slot.start) <= now) continue;
      if (date === session.date && slot.start === session.start) continue; // the time it's at now
      options.push({ date, ...slot });
    }
  }

  box.innerHTML = "";
  if (options.length === 0) {
    box.innerHTML = '<p class="hint">No time this week works for everyone. Try marking yourself as running late, or skip this one.</p>';
    return;
  }
  const title = document.createElement("p");
  title.className = "ns-times-title";
  title.textContent = "Everyone is free at these times:";
  box.appendChild(title);

  // A few per day, for the first few days that have any, so the list stays short
  const byDay = new Map();
  for (const o of options) {
    if (!byDay.has(o.date)) byDay.set(o.date, []);
    byDay.get(o.date).push(o);
  }
  for (const [date, list] of [...byDay].slice(0, 4)) {
    const row = document.createElement("div");
    row.className = "ns-day";
    const label = document.createElement("span");
    label.className = "ns-day-label";
    label.textContent = (soonText(date) === "Today" || soonText(date) === "Tomorrow" ? soonText(date) + " · " : "") + prettyDate(date);
    row.appendChild(label);
    const times = document.createElement("div");
    times.className = "ns-day-times";
    // Spread the picks across the day instead of only the first few half-hours
    const step = Math.max(1, Math.floor(list.length / 4));
    for (const o of list.filter((_, i) => i % step === 0).slice(0, 4)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ns-time-option";
      b.textContent = formatTime(o.start);
      b.title = formatTime(o.start) + " – " + formatTime(o.end);
      b.addEventListener("click", async () => {
        if (!confirm(`Move this week's session to ${prettyDate(o.date)}, ${formatTime(o.start)} – ${formatTime(o.end)}? Everyone will see the new time and answer again.`)) return;
        picker = null;
        await act(() => meetupRequest("/move", "POST", { sessionDate: session.sessionDate, date: o.date, start: o.start, end: o.end }));
      });
      times.appendChild(b);
    }
    row.appendChild(times);
    box.appendChild(row);
  }
}

// Run a change, then redraw everything with the fresh info
async function act(request) {
  showNote("next-error", "");
  showNote("meet-error", "");
  try {
    info = await request();
    renderAll();
  } catch (e) {
    showNote("next-error", e.message);
  }
}

// ----- Talk it over: a small chat for this session -----
// Checks for new messages every few seconds while the page is open and on screen.
const CHAT_POLL_MS = 5000;
const chat = { sessionDate: null, messages: [], ids: new Set(), timer: null, stopped: false, sending: false };

const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Show the chat for this session (called whenever the next session is drawn)
function openChat(sessionDate) {
  if (chat.stopped || chat.sessionDate === sessionDate) return;
  clearTimeout(chat.timer);
  Object.assign(chat, { sessionDate, messages: [], ids: new Set() });
  $("session-chat").hidden = false;
  $("sc-log").innerHTML = '<p class="sc-empty">Loading…</p>';
  pollChat(true);
}

function renderChat(stickToBottom) {
  const log = $("sc-log");
  log.innerHTML = "";
  if (chat.messages.length === 0) {
    log.innerHTML = '<p class="sc-empty">No messages yet. Need to change something about this session? Say so here.</p>';
    return;
  }
  let prev = null;
  for (const m of chat.messages) {
    const continues = prev && prev.author === m.author && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000;
    const row = document.createElement("div");
    row.className = "sc-msg" + (m.isYours ? " mine" : "") + (continues ? " continues" : "");
    if (!continues) {
      const meta = document.createElement("div");
      meta.className = "sc-meta";
      meta.innerHTML = "<strong></strong><span></span>";
      meta.querySelector("strong").textContent = m.author;
      meta.querySelector("span").textContent = clock(m.createdAt);
      row.appendChild(meta);
    }
    const bubble = document.createElement("div");
    bubble.className = "sc-bubble";
    bubble.textContent = m.body;
    bubble.title = new Date(m.createdAt).toLocaleString();
    row.appendChild(bubble);
    if (m.isYours) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sc-delete";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete this message");
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this message for everyone in the group?")) return;
        const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages/${m.id}`, { method: "DELETE" });
        if (!res.ok) return showNote("sc-error", "Couldn't delete that message. Try again.");
        chat.messages = chat.messages.filter((x) => x.id !== m.id);
        renderChat(false);
      });
      row.appendChild(remove);
    }
    log.appendChild(row);
    prev = m;
  }
  if (stickToBottom) log.scrollTop = log.scrollHeight;
}

function addChatMessages(list) {
  let added = 0;
  for (const m of list) {
    if (chat.ids.has(m.id)) continue;
    chat.ids.add(m.id);
    chat.messages.push(m);
    added++;
  }
  if (added) chat.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return added;
}

async function pollChat(first) {
  clearTimeout(chat.timer);
  if (chat.stopped || !chat.sessionDate) return;
  const session = chat.sessionDate;
  const last = chat.messages[chat.messages.length - 1];
  try {
    const list = await meetupRequest(`/messages?session=${session}` + (last ? "&after=" + encodeURIComponent(last.createdAt) : ""), "GET");
    if (session !== chat.sessionDate) return; // the session changed while this was loading
    const log = $("sc-log");
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (addChatMessages(list) || first) renderChat(first || nearBottom);
  } catch (e) {
    if ($("next-error").textContent) { // not set up yet: hide the chat instead of retrying
      chat.stopped = true;
      $("session-chat").hidden = true;
      return;
    }
  }
  if (!document.hidden) chat.timer = setTimeout(() => pollChat(false), CHAT_POLL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(chat.timer);
  else pollChat(false); // back on the tab: catch up right away
});

async function sendChat() {
  const input = $("sc-input");
  const body = input.value.trim();
  if (!body || chat.sending || !chat.sessionDate) return;
  chat.sending = true;
  $("sc-send").disabled = true;
  showNote("sc-error", "");
  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionDate: chat.sessionDate, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNote("sc-error", data.error || "Couldn't send that. Try again.");
      if (data.needsName) {
        const link = document.createElement("a");
        link.href = "/account#name";
        link.textContent = " Add your name";
        $("sc-error").appendChild(link);
      }
      return;
    }
    input.value = "";
    addChatMessages([data]);
    renderChat(true);
  } catch {
    showNote("sc-error", "Couldn't send that. Check your connection and try again.");
  } finally {
    chat.sending = false;
    $("sc-send").disabled = !input.value.trim();
    input.focus();
  }
}

$("sc-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat();
});
$("sc-input").addEventListener("input", () => { $("sc-send").disabled = chat.sending || !$("sc-input").value.trim(); });
document.querySelectorAll(".sc-idea").forEach((chip) => chip.addEventListener("click", () => {
  $("sc-input").value = chip.textContent;
  $("sc-send").disabled = false;
  $("sc-input").focus();
}));

// ----- Where we're meeting: the spot and suggestions -----
function renderMeetup() {
  const status = $("meet-status");
  status.innerHTML = "";
  if (info.meetup) {
    const card = document.createElement("div");
    card.className = "mt-card";
    card.innerHTML = '<span class="mt-pin" aria-hidden="true">📍</span><div class="mt-card-text">' +
      '<span class="mt-label">Meeting spot</span><strong class="mt-place"></strong><span class="mt-when"></span></div>';
    card.querySelector(".mt-place").textContent = info.meetup.place;
    card.querySelector(".mt-when").textContent = "Set by " + info.meetup.setBy;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-button mt-clear";
    clear.textContent = "Clear";
    clear.title = "Remove the meeting spot";
    clear.addEventListener("click", async () => {
      if (!confirm("Clear the meeting spot for everyone in the group?")) return;
      await spotChange(() => meetupRequest("/meetup", "DELETE"));
    });
    card.appendChild(clear);
    status.appendChild(card);
  } else {
    status.innerHTML = '<div class="mt-card mt-card-empty"><span class="mt-pin" aria-hidden="true">🗺️</span>' +
      '<div class="mt-card-text"><strong>No meeting spot yet</strong>' +
      '<span>Suggest a place below and vote. When it looks settled, make it the spot.</span></div></div>';
  }

  const list = $("spot-list");
  list.innerHTML = "";
  if (info.spots.length === 0) {
    list.innerHTML = '<li class="spot-empty">No ideas yet. Be the first to suggest a place.</li>';
  }
  for (const spot of info.spots) {
    const li = document.createElement("li");
    li.className = "spot" + (spot.isTheSpot ? " is-the-spot" : "");

    const vote = document.createElement("button");
    vote.type = "button";
    vote.className = "spot-vote";
    vote.setAttribute("aria-pressed", String(spot.votedByYou));
    vote.setAttribute("aria-label", (spot.votedByYou ? "Take back your vote for " : "Vote for ") + spot.place);
    vote.innerHTML = '<span aria-hidden="true">👍</span><span class="spot-count"></span>';
    vote.querySelector(".spot-count").textContent = spot.votes;
    vote.addEventListener("click", () => spotChange(() => meetupRequest(`/spots/${spot.id}/vote`, "POST", { on: !spot.votedByYou })));

    const text = document.createElement("div");
    text.className = "spot-text";
    text.innerHTML = "<strong></strong><span></span>";
    text.querySelector("strong").textContent = spot.place;
    text.querySelector("span").textContent = "Suggested by " + spot.by;
    li.append(vote, text);

    if (spot.isTheSpot) {
      const tag = document.createElement("span");
      tag.className = "spot-chosen";
      tag.textContent = "✓ The spot";
      li.appendChild(tag);
    } else {
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "spot-choose";
      choose.textContent = "Make it the spot";
      choose.addEventListener("click", () => {
        const ask = info.meetup ? `Change the meeting spot to "${spot.place}"?` : `Make "${spot.place}" the meeting spot?`;
        if (confirm(ask)) spotChange(() => meetupRequest("/meetup", "POST", { place: spot.place }));
      });
      li.appendChild(choose);
    }
    if (spot.isYours) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "spot-remove";
      remove.textContent = "×";
      remove.title = "Remove your suggestion";
      remove.setAttribute("aria-label", "Remove your suggestion " + spot.place);
      remove.addEventListener("click", () => spotChange(() => meetupRequest(`/spots/${spot.id}`, "DELETE")));
      li.appendChild(remove);
    }
    list.appendChild(li);
  }
  $("meet-ideas").hidden = false;
}

async function spotChange(request) {
  showNote("meet-error", "");
  try {
    info = await request();
    renderAll();
  } catch (e) {
    showNote("meet-error", e.message);
  }
}

$("spot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("spot-input");
  if (!input.value.trim()) return input.focus();
  $("spot-submit").disabled = true;
  await spotChange(async () => {
    const data = await meetupRequest("/spots", "POST", { place: input.value });
    input.value = "";
    return data;
  });
  $("spot-submit").disabled = false;
});

async function startMeetups(group) {
  currentGroup = group;
  try {
    info = await meetupRequest("/meetup", "GET");
    renderAll();
  } catch (e) {
    if (!$("next-error").textContent) showNote("next-error", "Couldn't load your next session. Refresh the page to try again.");
    $("next-card").innerHTML = "";
    $("meet-status").innerHTML = "";
  }
}

async function load() {
  if (!groupId) return showError("No group picked. Go back to your study plan and pick your group.");
  const res = await fetch("/api/groups/" + encodeURIComponent(groupId));
  if (res.status === 404) return showError("That group doesn't exist, or you're not in it anymore.");
  if (!res.ok) return showError("Couldn't load this group. Refresh the page to try again.");
  const { group, notes } = await res.json();
  renderGroup(group);
  $("discord-section").hidden = !group.discordEnabled; // class Discord is paused for now
  if (group.course) {
    $("discord-title").textContent = "Chat with your " + group.course + " class";
    $("discord-hint").querySelector("strong").textContent = "everyone taking " + group.course;
  }
  discord = discordFrom(group);
  renderDiscord();
  for (const note of notes) $("notes").appendChild(noteCard(note));
  updateEmpty();
  $("group-body").hidden = false;
  startMeetups(group);
}
load();
