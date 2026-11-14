// StudySync - the Notes page (runs in the browser): every note shared in your study groups,
// newest first, with a filter per group and a form to add one to any of your groups.
// Data: GET /api/notes → [{ group, notes }] (routes/groups.js). Cards: public/note-card.js.

const $ = (id) => document.getElementById(id);
let groups = []; // [{ id, course, label, hue, notes }]
let showing = "all"; // "all" or a group ID

// "CSC 130 | Group A" → { course: "CSC 130", label: "Group A" }
function splitName(group) {
  const [course, ...rest] = String(group.name).split(" | ");
  return { course: group.course || course, label: rest.join(" | ") };
}

function render() {
  const list = $("notes");
  list.innerHTML = "";
  const shown = groups.filter((g) => showing === "all" || g.id === showing);
  const notes = shown
    .flatMap((g) => g.notes.map((note) => ({ note, group: g })))
    .sort((a, b) => new Date(b.note.createdAt) - new Date(a.note.createdAt));
  for (const { note, group } of notes) {
    list.appendChild(window.studyNotes.card(note, {
      groupId: group.id,
      group: showing === "all" ? group : null,
      onRemoved: () => { group.notes = group.notes.filter((n) => n.id !== note.id); renderFilters(); render(); },
    }));
  }
  const total = groups.reduce((sum, g) => sum + g.notes.length, 0);
  $("notes-count").textContent = total ? String(total) : "";
  $("notes-empty").hidden = notes.length > 0;
  $("notes-empty").textContent = showing === "all"
    ? "No notes yet. Add the first one, and everyone in that group will see it."
    : "No notes in this group yet. Add the first one!";
}

// Filter chips: All · CSC 130 (3) · MATH 31 (1)
function renderFilters() {
  const box = $("notes-filters");
  box.innerHTML = "";
  box.hidden = groups.length < 2;
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
    button.addEventListener("click", () => { showing = id; renderFilters(); render(); });
    box.appendChild(button);
  };
  chip("all", "All", groups.reduce((sum, g) => sum + g.notes.length, 0));
  for (const g of groups) chip(g.id, g.course, g.notes.length, g.hue);
}

// The form's group picker: the filtered group if there is one
function fillGroupPicker() {
  const pick = $("note-group");
  pick.innerHTML = "";
  for (const g of groups) {
    const option = document.createElement("option");
    option.value = g.id;
    option.textContent = g.course + (g.label ? " · " + g.label : "");
    pick.appendChild(option);
  }
  if (showing !== "all") pick.value = showing;
  $("note-group-row").hidden = groups.length < 2;
}

function showNoteForm(open) {
  $("note-form").hidden = !open;
  $("note-open").hidden = open;
  if (open) { fillGroupPicker(); $("note-title").focus(); }
  else { $("note-form").reset(); $("note-error").hidden = true; }
}
$("note-open").addEventListener("click", () => showNoteForm(true));
$("note-cancel").addEventListener("click", () => showNoteForm(false));

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("note-error").hidden = true;
  $("note-submit").disabled = true;
  const group = groups.find((g) => g.id === $("note-group").value) || groups[0];
  try {
    const res = await fetch("/api/groups/" + group.id + "/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: $("note-title").value, body: $("note-body").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't add the note. Try again.");
    group.notes.unshift(data);
    showNoteForm(false);
    renderFilters();
    render();
  } catch (error) {
    $("note-error").textContent = error.message;
    $("note-error").hidden = false;
  } finally {
    $("note-submit").disabled = false;
  }
});

async function load() {
  try {
    const res = await fetch("/api/notes");
    if (!res.ok) throw new Error();
    const data = await res.json();
    groups = data.map(({ group, notes }) => {
      const { course, label } = splitName(group);
      return { id: group.id, course, label, hue: window.studyMembers.hueFor(course), notes };
    });
  } catch {
    $("notes-loading").textContent = "Couldn't load your notes. Refresh the page to try again.";
    return;
  }
  $("notes-loading").hidden = true;
  if (!groups.length) {
    $("notes-no-groups").hidden = false;
    return;
  }
  $("notes-main").hidden = false;
  renderFilters();
  render();
}
load();
