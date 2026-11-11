// StudySync - one study group's page (runs in the browser): who's in it, when it meets,
// where the group meets (and its Discord), and the notes members share with each other.

const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const $ = (id) => document.getElementById(id);
const groupId = new URLSearchParams(location.search).get("id") || "";

// Turn "14:30" into "2:30 PM"
function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ampm;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function showError(message) {
  $("load-error").textContent = message;
  $("load-error").hidden = false;
}

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

// ---------- Where we're meeting + Discord (meetups.js on the server) ----------
let currentGroup = null;
let info = null; // { meetup, spots, discord } from the server

const whenText = (group) => group.days.map((d) => DAY_SHORT[d]).join(", ") + " · " +
  formatTime(group.start) + " – " + formatTime(group.end);

function showMeetError(text) {
  $("meet-error").textContent = text || "";
  $("meet-error").hidden = !text;
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
  $("meet-status").innerHTML = "";
  $("meet-ideas").hidden = true;
  $("discord-section").hidden = true;
  showMeetError(message);
}

function renderMeetup() {
  const status = $("meet-status");
  status.innerHTML = "";
  if (info.meetup) {
    const card = document.createElement("div");
    card.className = "mt-card";
    card.innerHTML = '<span class="mt-pin" aria-hidden="true">📍</span><div class="mt-card-text">' +
      '<span class="mt-label">Meeting spot</span><strong class="mt-place"></strong><span class="mt-when"></span></div>';
    card.querySelector(".mt-place").textContent = info.meetup.place;
    card.querySelector(".mt-when").textContent = whenText(currentGroup) + " · set by " + info.meetup.setBy;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-button mt-clear";
    clear.textContent = "Clear";
    clear.title = "Remove the meeting spot";
    clear.addEventListener("click", async () => {
      if (!confirm("Clear the meeting spot for everyone in the group?")) return;
      try { info = await meetupRequest("/meetup", "DELETE"); renderMeetup(); } catch (e) { showMeetError(e.message); }
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
    vote.addEventListener("click", () => change(`/spots/${spot.id}/vote`, "POST", { on: !spot.votedByYou }));

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
      choose.addEventListener("click", () => setSpot(spot.place));
      li.appendChild(choose);
    }
    if (spot.isYours) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "spot-remove";
      remove.textContent = "×";
      remove.title = "Remove your suggestion";
      remove.setAttribute("aria-label", "Remove your suggestion " + spot.place);
      remove.addEventListener("click", () => change(`/spots/${spot.id}`, "DELETE"));
      li.appendChild(remove);
    }
    list.appendChild(li);
  }
  $("meet-ideas").hidden = false;
}

async function change(path, method, body) {
  showMeetError("");
  try {
    info = await meetupRequest(path, method, body);
    renderMeetup();
    renderDiscord();
  } catch (e) {
    showMeetError(e.message);
  }
}

async function setSpot(place) {
  const ask = info.meetup ? `Change the meeting spot to "${place}"?` : `Make "${place}" the meeting spot?`;
  if (!confirm(ask + (info.discord.connected ? " It'll be posted to your Discord channel." : ""))) return;
  showMeetError("");
  try {
    info = await meetupRequest("/meetup", "POST", { place });
    renderMeetup();
    if (info.discordConnected && !info.posted) {
      showMeetError("The spot is saved, but Discord didn't accept the post. The webhook may have been deleted: set it up again below.");
    } else if (info.posted) {
      flash($("meet-status"), "Posted to your Discord channel ✓");
    }
  } catch (e) {
    showMeetError(e.message);
  }
}

// A small note that fades away
function flash(after, text) {
  const note = document.createElement("p");
  note.className = "mt-flash";
  note.textContent = text;
  after.after(note);
  setTimeout(() => note.remove(), 4000);
}

$("spot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("spot-input");
  if (!input.value.trim()) return input.focus();
  $("spot-submit").disabled = true;
  showMeetError("");
  try {
    info = await meetupRequest("/spots", "POST", { place: input.value });
    input.value = "";
    renderMeetup();
  } catch (e) {
    showMeetError(e.message);
  } finally {
    $("spot-submit").disabled = false;
  }
});

// ----- Discord -----
const DISCORD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.7 16.7 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 11 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.4-4.3-.7-8-3-11.4ZM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>';

function linkButton(href, label, primary) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.className = "dc-button" + (primary ? " primary" : "");
  a.innerHTML = DISCORD_ICON + "<span></span>";
  a.querySelector("span").textContent = label;
  return a;
}

function renderDiscord() {
  const d = info.discord;
  const view = $("discord-view");
  view.innerHTML = "";
  const course = currentGroup.course;

  const buttons = document.createElement("div");
  buttons.className = "dc-buttons";
  if (d.serverInvite) buttons.appendChild(linkButton(d.serverInvite, `Join the ${course} server`, !d.channelUrl));
  if (d.channelUrl) buttons.appendChild(linkButton(d.channelUrl, "Open your group's channel", true));
  if (buttons.children.length) view.appendChild(buttons);

  const status = document.createElement("p");
  status.className = "dc-status" + (d.connected ? " on" : "");
  status.textContent = d.connected
    ? "✓ Meeting spots are posted to your group's channel."
    : !d.serverInvite && !d.channelUrl
      ? `No Discord linked yet. If ${course} has a Discord server, add its invite so your group can find it.`
      : "Meeting spots aren't posted to Discord yet. Add a channel webhook to turn that on.";
  view.appendChild(status);

  $("discord-edit").textContent = d.serverInvite || d.channelUrl || d.connected ? "Edit" : "Set up";
  $("discord-invite-hint").textContent = `Shared with every study group in ${course}.`;
  $("discord-section").hidden = false;
}

function openDiscordForm() {
  const d = info.discord;
  $("discord-invite").value = d.serverInvite;
  $("discord-channel").value = d.channelUrl;
  $("discord-webhook").value = "";
  $("discord-webhook").placeholder = d.connected ? "Connected. Paste a new link to replace it." : "https://discord.com/api/webhooks/…";
  $("discord-disconnect").checked = false;
  $("discord-disconnect-row").hidden = !d.connected;
  $("discord-error").hidden = true;
  $("discord-form").hidden = false;
  $("discord-edit").hidden = true;
  $("discord-invite").focus();
}

function closeDiscordForm() {
  $("discord-form").hidden = true;
  $("discord-edit").hidden = false;
}

$("discord-edit").addEventListener("click", openDiscordForm);
$("discord-cancel").addEventListener("click", closeDiscordForm);
$("discord-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = { serverInvite: $("discord-invite").value, channelUrl: $("discord-channel").value };
  const webhook = $("discord-webhook").value.trim();
  if (webhook) body.webhookUrl = webhook;
  else if ($("discord-disconnect").checked) body.webhookUrl = "";

  $("discord-save").disabled = true;
  $("discord-save").textContent = webhook ? "Connecting…" : "Saving…";
  $("discord-error").hidden = true;
  try {
    info = await meetupRequest("/discord", "POST", body);
    closeDiscordForm();
    renderDiscord();
    if (webhook) flash($("discord-view"), "Connected. StudySync said hi in your channel ✓");
  } catch (e) {
    $("discord-error").textContent = e.message;
    $("discord-error").hidden = false;
  } finally {
    $("discord-save").disabled = false;
    $("discord-save").textContent = "Save";
  }
});

async function startMeetups(group) {
  currentGroup = group;
  try {
    info = await meetupRequest("/meetup", "GET");
    renderMeetup();
    renderDiscord();
  } catch (e) {
    if (!$("meet-error").textContent) showMeetError("Couldn't load the meeting spot. Refresh the page to try again.");
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
  for (const note of notes) $("notes").appendChild(noteCard(note));
  updateEmpty();
  $("group-body").hidden = false;
  startMeetups(group);
}
load();
