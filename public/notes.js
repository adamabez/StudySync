// StudySync - the Notes page (runs in the browser): your notes and your study groups' notes,
// newest first. Each note belongs to one of your groups and is either shared with the group or
// private (only you see it). Filter: All · each group · 🔒 Private. Add a note to a group, private
// or shared, and switch your own notes either way later.
// Data: GET /api/notes → [{ group, notes }] (routes/groups.js) and GET /api/private-notes →
// { notes, notSetUp? } (routes/notes.js). Cards: public/note-card.js.

const $ = (id) => document.getElementById(id);
const PRIVATE = "private";
let groups = [];       // [{ id, course, label, hue }]
let notes = [];        // [{ ...note, groupId, isPrivate }]
let canPrivate = true; // false until supabase/private-notes.sql is run
let showing = "all";   // "all", PRIVATE or a group ID
let myName = "You";     // your initials on private notes match your shared ones
// A private note, with your name on it like your group notes
const asPrivate = (n, groupId) => ({ ...n, groupId: n.groupId === undefined ? groupId : n.groupId, author: myName, isPrivate: true });

// "CSC 130 | Group A" → { course: "CSC 130", label: "Group A" }
function splitName(group) {
  const [course, ...rest] = String(group.name).split(" | ");
  return { course: group.course || course, label: rest.join(" | ") };
}
const groupById = (id) => groups.find((g) => g.id === id) || null;
const groupName = (g) => g.course + (g.label ? " · " + g.label : "");
const matches = (note, filter) => filter === "all" || (filter === PRIVATE ? note.isPrivate : note.groupId === filter);

function redraw() {
  renderFilters();
  render();
}

// Your note switched between private and shared: the server answers with the moved note
async function flipPrivacy(note) {
  const url = note.isPrivate ? "/api/private-notes/" + note.id + "/share"
    : "/api/groups/" + note.groupId + "/notes/" + note.id + "/private";
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || "Couldn't change that note. Try again.");
  const moved = data.isPrivate ? asPrivate(data, note.groupId) : { ...data, groupId: data.groupId || note.groupId, isPrivate: false };
  notes = notes.map((n) => (n === note ? moved : n));
  redraw();
}

function render() {
  const list = $("notes");
  list.innerHTML = "";
  const shown = notes
    .filter((n) => matches(n, showing))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  for (const note of shown) {
    const group = groupById(note.groupId);
    list.appendChild(window.studyNotes.card(note, {
      groupId: note.groupId,
      group: showing === "all" || showing === PRIVATE ? group : null,
      onPrivacy: canPrivate ? flipPrivacy : null,
      onRemoved: () => { notes = notes.filter((n) => n !== note); redraw(); },
    }));
  }
  $("notes-count").textContent = notes.length ? String(notes.length) : "";
  $("notes-empty").hidden = shown.length > 0;
  $("notes-empty").textContent = showing === "all" ? "No notes yet. Add your first one!"
    : showing === PRIVATE ? "No private notes yet. Private notes are only visible to you."
    : "No notes in this group yet. Add the first one!";
}

// Filter chips: All · CSC 130 · MATH 31 · 🔒 Private (each with how many notes)
function renderFilters() {
  const box = $("notes-filters");
  box.innerHTML = "";
  const chips = [["all", "All"], ...groups.map((g) => [g.id, g.course, g.hue]), ...(canPrivate ? [[PRIVATE, "🔒 Private"]] : [])];
  box.hidden = chips.length < 3;
  for (const [id, text, hue] of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notes-filter";
    button.setAttribute("aria-pressed", String(showing === id));
    if (hue !== undefined) button.style.setProperty("--g-hue", hue);
    button.textContent = text;
    const n = document.createElement("span");
    n.textContent = notes.filter((note) => matches(note, id)).length;
    button.appendChild(n);
    button.addEventListener("click", () => { showing = id; redraw(); });
    box.appendChild(button);
  }
}

// ---------- Adding a note: which group, and Private / Shared with group ----------
let visibility = "private";

function setVisibility(value) {
  visibility = value;
  for (const button of document.querySelectorAll("#note-visibility button")) {
    button.setAttribute("aria-pressed", String(button.dataset.value === value));
  }
  updateWho();
}

function updateWho() {
  const group = groupById($("note-group").value);
  const shareButton = document.querySelector('#note-visibility [data-value="shared"]');
  shareButton.disabled = !group;
  if (!group && visibility === "shared") return setVisibility("private");
  $("note-who").textContent = visibility === "private" ? "Only you will see this note. You can share it later."
    : "Everyone in " + groupName(group) + " will see this note.";
}

function fillForm() {
  const pick = $("note-group");
  pick.innerHTML = "";
  for (const g of groups) pick.add(new Option(groupName(g), g.id));
  if (canPrivate) pick.add(new Option("No group", ""));
  pick.value = groupById(showing) ? showing : groups[0] ? groups[0].id : "";
  $("note-group-row").hidden = groups.length === 0;
  // No private notes yet (database not set up): everything is shared
  $("note-visibility-row").hidden = !canPrivate || groups.length === 0;
  setVisibility(!canPrivate ? "shared" : showing === PRIVATE || groups.length === 0 ? "private" : visibility);
}

for (const button of document.querySelectorAll("#note-visibility button")) {
  button.addEventListener("click", () => setVisibility(button.dataset.value));
}
$("note-group").addEventListener("change", updateWho);

function showNoteForm(open) {
  $("note-form").hidden = !open;
  $("note-open").hidden = open;
  if (open) { fillForm(); $("note-title").focus(); }
  else { $("note-form").reset(); $("note-error").hidden = true; }
}
$("note-open").addEventListener("click", () => showNoteForm(true));
$("note-cancel").addEventListener("click", () => showNoteForm(false));

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("note-error").hidden = true;
  $("note-submit").disabled = true;
  const groupId = $("note-group").value || null;
  const input = { title: $("note-title").value, body: $("note-body").value };
  const shared = visibility === "shared" && groupId;
  try {
    const res = await fetch(shared ? "/api/groups/" + groupId + "/notes" : "/api/private-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shared ? input : { ...input, groupId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't add the note. Try again.");
    notes.unshift(shared ? { ...data, groupId, isPrivate: false } : asPrivate(data, groupId));
    showNoteForm(false);
    redraw();
  } catch (error) {
    $("note-error").textContent = error.message;
    $("note-error").hidden = false;
  } finally {
    $("note-submit").disabled = false;
  }
});

async function load() {
  let groupData, privateData;
  try {
    const [groupRes, privateRes] = await Promise.all([fetch("/api/notes"), fetch("/api/private-notes")]);
    if (!groupRes.ok) throw new Error();
    groupData = await groupRes.json();
    privateData = privateRes.ok ? await privateRes.json() : { notes: [], notSetUp: true };
  } catch {
    $("notes-loading").textContent = "Couldn't load your notes. Refresh the page to try again.";
    return;
  }
  const me = await window.studyNav.me;
  myName = (me && (me.name || me.email)) || "You";
  $("notes-loading").hidden = true;
  canPrivate = !privateData.notSetUp;
  groups = groupData.map(({ group }) => {
    const { course, label } = splitName(group);
    return { id: group.id, course, label, hue: window.studyMembers.hueFor(course) };
  });
  notes = [
    ...groupData.flatMap(({ group, notes: list }) => list.map((n) => ({ ...n, groupId: group.id, isPrivate: false }))),
    ...privateData.notes.map((n) => asPrivate(n)),
  ];

  // Not in a group yet: say where group notes come from (private notes still work)
  $("notes-no-groups").hidden = groups.length > 0;
  if (!groups.length && !canPrivate) return;
  $("notes-main").hidden = false;
  $("notes-hint").textContent = !canPrivate ? "Everyone in a group can see its notes. You can delete the ones you added."
    : groups.length ? "Notes are shared with your group, or private so only you see them. Switch your own notes either way anytime."
    : "Your notes are private for now. Once you're in a study group, you can share them with it.";
  redraw();
}
load();
