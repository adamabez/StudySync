// StudySync - the Notes page (runs in the browser): your solo notes (only you see them) and every
// note shared in your study groups, newest first, with a filter (All · Just me · each group) and a
// form to add a note just for yourself or to any of your groups.
// Data: GET /api/solo-notes → { notes, notSetUp? } (routes/notes.js) and GET /api/notes →
// [{ group, notes }] (routes/groups.js). Cards: public/note-card.js.

const $ = (id) => document.getElementById(id);
const SOLO = "solo";
// Where notes live: your solo notes first (when set up), then each group.
// [{ id, solo, course, label, hue, notes }]
let places = [];
let showing = "all"; // "all", SOLO or a group ID

// "CSC 130 | Group A" → { course: "CSC 130", label: "Group A" }
function splitName(group) {
  const [course, ...rest] = String(group.name).split(" | ");
  return { course: group.course || course, label: rest.join(" | ") };
}

const placeName = (p) => (p.solo ? "Just me (private)" : p.course + (p.label ? " · " + p.label : ""));
const total = () => places.reduce((sum, p) => sum + p.notes.length, 0);

function redraw() {
  renderFilters();
  render();
}

function render() {
  const list = $("notes");
  list.innerHTML = "";
  const shown = places.filter((p) => showing === "all" || p.id === showing);
  const notes = shown
    .flatMap((p) => p.notes.map((note) => ({ note, place: p })))
    .sort((a, b) => new Date(b.note.createdAt) - new Date(a.note.createdAt));
  for (const { note, place } of notes) {
    list.appendChild(window.studyNotes.card(note, {
      groupId: place.id,
      solo: place.solo,
      showTag: showing === "all",
      group: showing === "all" && !place.solo ? place : null,
      onRemoved: () => { place.notes = place.notes.filter((n) => n.id !== note.id); redraw(); },
    }));
  }
  $("notes-count").textContent = total() ? String(total()) : "";
  $("notes-empty").hidden = notes.length > 0;
  $("notes-empty").textContent = showing === "all" ? "No notes yet. Add your first one!"
    : showing === SOLO ? "No solo notes yet. Notes you add for \"Just me\" are only visible to you."
    : "No notes in this group yet. Add the first one!";
}

// Filter chips: All · 🔒 Just me · CSC 130 · MATH 31 (each with how many notes)
function renderFilters() {
  const box = $("notes-filters");
  box.innerHTML = "";
  box.hidden = places.length < 2;
  const chip = (id, text, count, hue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notes-filter";
    button.setAttribute("aria-pressed", String(showing === id));
    if (hue !== undefined) button.style.setProperty("--g-hue", hue);
    button.textContent = text;
    const n = document.createElement("span");
    n.textContent = count;
    button.appendChild(n);
    button.addEventListener("click", () => { showing = id; redraw(); });
    box.appendChild(button);
  };
  chip("all", "All", total());
  for (const p of places) chip(p.id, p.solo ? "🔒 Just me" : p.course, p.notes.length, p.hue);
}

// Who sees the note: Just me, or one of your groups (starts on the filter you're looking at)
function fillPicker() {
  const pick = $("note-place");
  pick.innerHTML = "";
  for (const p of places) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.solo ? "Just me (private)" : "Group: " + placeName(p);
    pick.appendChild(option);
  }
  if (showing !== "all") pick.value = showing;
  $("note-place-row").hidden = places.length < 2;
  updateWho();
}
function updateWho() {
  const place = places.find((p) => p.id === $("note-place").value) || places[0];
  $("note-who").textContent = place.solo ? "Only you will see this note." : "Everyone in " + placeName(place) + " will see this note.";
}
$("note-place").addEventListener("change", updateWho);

function showNoteForm(open) {
  $("note-form").hidden = !open;
  $("note-open").hidden = open;
  if (open) { fillPicker(); $("note-title").focus(); }
  else { $("note-form").reset(); $("note-error").hidden = true; }
}
$("note-open").addEventListener("click", () => showNoteForm(true));
$("note-cancel").addEventListener("click", () => showNoteForm(false));

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("note-error").hidden = true;
  $("note-submit").disabled = true;
  const place = places.find((p) => p.id === $("note-place").value) || places[0];
  try {
    const res = await fetch(place.solo ? "/api/solo-notes" : "/api/groups/" + place.id + "/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: $("note-title").value, body: $("note-body").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't add the note. Try again.");
    place.notes.unshift(data);
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
  let groups, solo;
  try {
    const [groupRes, soloRes] = await Promise.all([fetch("/api/notes"), fetch("/api/solo-notes")]);
    if (!groupRes.ok) throw new Error();
    groups = await groupRes.json();
    solo = soloRes.ok ? await soloRes.json() : { notes: [], notSetUp: true };
  } catch {
    $("notes-loading").textContent = "Couldn't load your notes. Refresh the page to try again.";
    return;
  }
  $("notes-loading").hidden = true;
  places = groups.map(({ group, notes }) => {
    const { course, label } = splitName(group);
    return { id: group.id, solo: false, course, label, hue: window.studyMembers.hueFor(course), notes };
  });
  if (!solo.notSetUp) places.unshift({ id: SOLO, solo: true, course: "Just me", label: "", hue: 265, notes: solo.notes });

  // Not in a group yet: say where group notes come from (solo notes still work)
  $("notes-no-groups").hidden = groups.length > 0;
  if (!places.length) return;
  $("notes-main").hidden = false;
  $("notes-hint").textContent = groups.length
    ? "Solo notes are only for you. Group notes are shared with everyone in that group, and you can delete the ones you added."
    : "Solo notes are only for you. Once you're in a study group, you can share notes with it here too.";
  redraw();
}
load();
