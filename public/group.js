// StudySync - one study group's page (runs in the browser): who's in it, when it meets,
// and the notes members share with each other.

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
}
load();
