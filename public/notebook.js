// StudySync - Course materials + study assistant (runs in the browser).
// Left: the Library, a shelf of material cards for each class (MAX_TOTAL_BYTES in all).
// Click a card to read it; the check in its corner decides if the assistant uses it.
// Right: the study assistant, a chat that answers from the materials in use.
// Talks to the server's /api/sources, /api/chats and /api/notebook routes.

const QUICK_PROMPTS = {
  summary: "Give me a quick summary of these materials: a couple of sentences on what they're about, then the main ideas I should remember.",
  guide: "Make me a study guide from these materials: the key concepts with short explanations, the terms I need to know, and what's most likely to show up on an exam.",
  quiz: "Quiz me with 5 multiple-choice questions from these materials. Put the answers at the very end, with a one-line explanation for each.",
  terms: "What are the key terms in these materials? Give a short, clear definition for each.",
};

// The starter ideas on an empty chat
const STARTERS = [
  { prompt: "summary", icon: "📝", title: "Summarize", text: "The main ideas, fast" },
  { prompt: "guide", icon: "🗂️", title: "Study guide", text: "Concepts, terms, likely exam topics" },
  { prompt: "quiz", icon: "🎯", title: "Quiz me", text: "5 questions with answers" },
  { prompt: "terms", icon: "🔑", title: "Key terms", text: "Short, clear definitions" },
];

// Same limits as the server (materials.js)
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 50_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // everything in the library together

const ICONS = {
  text: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z M12 2.5v3h3 M7.5 9h5M7.5 12h5M7.5 15h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  pdf: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z M12 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><text x="10" y="14.6" text-anchor="middle" font-size="5.2" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">PDF</text></svg>',
  check: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const nb = {
  sources: [],          // every saved material (from the server)
  courses: [],          // class names from the calendar
  course: "",           // which tab is showing: "" = all classes, else a class name
  unchecked: new Set(), // materials the student turned off for answers
  chats: [],            // saved chats for the dropdown: [{ id, title, updatedAt, questions }]
  chatId: null,         // the chat on screen (null = a new chat that isn't saved yet)
  aiEnabled: false,
  busy: false,
  mode: "file",         // Add dialog: "file" or "paste"
  justAdded: null,      // id of the material just added, to highlight it once
  search: "",
  collapsed: new Set(), // class shelves folded away (remembered between visits)
  order: [],            // ids in the order the cards show, for ‹ › in the viewer
  viewing: null,        // id of the material open in the viewer
  texts: new Map(),     // notes already loaded into the viewer, by id
  lastAsk: null,        // { question, label } to retry after an error
};

const COLLAPSED_KEY = "studysync-nb-collapsed";
try { nb.collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]")); } catch {}

const $ = (id) => document.getElementById(id);

// ---------- Small helpers ----------
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function formatDate(iso) {
  const date = new Date(iso);
  return isNaN(date) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// "2 pages" reads friendlier than "4,210 chars" (about 3,000 characters a page)
function formatSize(source) {
  if (source.type === "pdf") return formatBytes(source.size);
  const pages = Math.max(1, Math.round(source.size / 3000));
  return pages === 1 ? "1 page" : `${pages} pages`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Materials under the current tab, and the ones the assistant will use
function visibleSources() {
  return nb.course === "" ? nb.sources : nb.sources.filter((s) => s.course === nb.course);
}
function selectedSources() {
  return visibleSources().filter((s) => !nb.unchecked.has(s.id));
}
const countIn = (course) => nb.sources.filter((s) => s.course === course).length;
const usedBytes = () => nb.sources.reduce((sum, s) => sum + (s.size || 0), 0);
const formatMB = (bytes) => bytes > 0 && bytes < 1024 * 1024 ? formatBytes(bytes) : (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(/\.0$/, "") + " MB";

// ---------- Class tabs ----------
function courseNames() {
  return [...new Set([...nb.courses, ...nb.sources.map((s) => s.course).filter(Boolean)])].sort();
}

function renderCourseTabs() {
  const names = courseNames();
  if (nb.course && !names.includes(nb.course)) nb.course = "";
  if (names.length < 2) nb.course = "";

  const nav = $("nb-courses");
  nav.innerHTML = "";
  nav.hidden = names.length < 2;
  for (const value of ["", ...names]) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "nb-course-tab";
    tab.setAttribute("aria-pressed", String(value === nb.course));
    const count = value ? countIn(value) : nb.sources.length;
    tab.innerHTML = `<span>${escapeHtml(value || "All classes")}</span><span class="tab-count">${count}</span>`;
    tab.onclick = () => {
      nb.course = value;
      renderAll();
    };
    nav.appendChild(tab);
  }
}

// ---------- Library ----------
function matchesSearch(s) {
  const q = nb.search.trim().toLowerCase();
  return !q || s.title.toLowerCase().includes(q) || (s.course || "").toLowerCase().includes(q);
}

function renderLibrary() {
  const list = $("source-list");
  const searching = nb.search.trim() !== "";
  list.innerHTML = "";
  nb.order = [];
  $("source-search-wrap").hidden = nb.sources.length < 6 && !searching;

  const names = courseNames();
  if (names.length === 0 && nb.sources.length === 0) {
    list.appendChild(emptyLibrary());
    nb.justAdded = null;
    return;
  }

  // One shelf per class (plus "Other" for anything without a class), or just the picked one
  let shelves = nb.course ? [nb.course] : [...names];
  if (!nb.course && nb.sources.some((s) => !s.course)) shelves.push("");

  let anyShown = false;
  for (const course of shelves) {
    const all = nb.sources.filter((s) => s.course === course)
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    const items = all.filter(matchesSearch);
    if (searching && items.length === 0) continue;
    anyShown = true;
    list.appendChild(shelf(course, all, items, searching));
  }

  if (!anyShown) {
    const none = document.createElement("p");
    none.className = "nb-quiet";
    none.textContent = `Nothing matches “${nb.search.trim()}”.`;
    list.appendChild(none);
  }
  nb.justAdded = null;
  renderStorage();
}

// "12 MB of 50 MB used" at the bottom of the Library
function renderStorage() {
  const used = usedBytes();
  const box = $("nb-storage");
  box.hidden = nb.sources.length === 0;
  const share = Math.min(100, (used / MAX_TOTAL_BYTES) * 100);
  box.classList.toggle("nearly-full", share >= 85);
  box.innerHTML = `<span class="meter"><span style="width:${Math.max(share, used ? 1.5 : 0)}%"></span></span>` +
    `<span>${formatMB(used)} of ${formatMB(MAX_TOTAL_BYTES)} used${share >= 100 ? " · remove something to add more" : ""}</span>`;
}

function shelf(course, all, items, searching) {
  const section = document.createElement("section");
  const canFold = nb.course === "" && !searching;
  const open = !canFold || !nb.collapsed.has(course);
  section.className = "nb-shelf" + (open ? "" : " closed");

  // Heading: name, "3 of 8" with a small meter, and + to add to this class
  const head = document.createElement("div");
  head.className = "nb-shelf-head";
  const name = document.createElement(canFold ? "button" : "div");
  name.className = "nb-shelf-name";
  if (canFold) {
    name.type = "button";
    name.setAttribute("aria-expanded", String(open));
    name.onclick = () => {
      nb.collapsed.has(course) ? nb.collapsed.delete(course) : nb.collapsed.add(course);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...nb.collapsed])); } catch {}
      renderLibrary();
    };
  }
  name.innerHTML = (canFold ? `<span class="nb-shelf-arrow">${ICONS.chevron}</span>` : "") +
    `<span>${escapeHtml(course || "Other")}</span>`;

  const room = document.createElement("div");
  room.className = "nb-shelf-room";
  room.textContent = plural(all.length, "material");
  head.append(name, room);
  section.appendChild(head);

  if (!open) return section;

  const grid = document.createElement("ul");
  grid.className = "nb-cards";
  for (const s of items) {
    grid.appendChild(card(s));
    nb.order.push(s.id);
  }
  // An "add" card at the end (not while searching or for "Other")
  if (course && !searching) {
    const li = document.createElement("li");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "nb-card nb-card-add";
    add.innerHTML = `<span class="nb-card-plus" aria-hidden="true">+</span><span>${all.length ? "Add" : "Add notes or a PDF"}</span>`;
    add.setAttribute("aria-label", `Add material to ${course}`);
    add.onclick = () => openAddDialog(course);
    li.appendChild(add);
    grid.appendChild(li);
  }
  section.appendChild(grid);
  return section;
}

function card(s) {
  const li = document.createElement("li");
  const used = !nb.unchecked.has(s.id);
  li.className = "nb-card-wrap" + (used ? "" : " unused") + (s.id === nb.justAdded ? " just-added" : "");

  const open = document.createElement("button");
  open.type = "button";
  open.className = "nb-card";
  open.title = s.title;
  open.innerHTML =
    `<span class="type-icon ${s.type}">${ICONS[s.type] || ICONS.text}</span>` +
    `<span class="nb-card-title">${escapeHtml(s.title)}</span>` +
    `<span class="nb-card-meta">${escapeHtml([formatDate(s.addedAt), formatSize(s)].filter(Boolean).join(" · "))}</span>`;
  open.onclick = () => openViewer(s.id);

  const use = document.createElement("button");
  use.type = "button";
  use.className = "nb-card-use";
  use.setAttribute("role", "switch");
  use.setAttribute("aria-checked", String(used));
  use.setAttribute("aria-label", `Use "${s.title}" in answers`);
  use.title = used ? "Used in answers · click to leave it out" : "Left out of answers · click to use it";
  use.innerHTML = ICONS.check;
  use.onclick = () => setUsed(s.id, nb.unchecked.has(s.id));

  li.append(open, use);
  return li;
}

function setUsed(id, used) {
  used ? nb.unchecked.delete(id) : nb.unchecked.add(id);
  renderLibrary();
  renderContext();
}

function emptyLibrary() {
  const div = document.createElement("div");
  div.className = "nb-empty-library";
  div.innerHTML = `<span class="nb-empty-icon" aria-hidden="true">📚</span>
    <strong>Start with a class</strong>
    <span>Add a class to your week, then keep its notes and readings here.</span>`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nb-primary";
  button.textContent = "+ Add a class";
  button.onclick = () => document.getElementById("add-open")?.click();
  div.appendChild(button);
  return div;
}

async function removeSource(s) {
  if (!confirm(`Remove "${s.title}" from your library?`)) return false;
  try {
    await api("/api/sources/" + s.id, { method: "DELETE" });
    nb.sources = nb.sources.filter((x) => x.id !== s.id);
    nb.unchecked.delete(s.id);
    nb.texts.delete(s.id);
    renderAll();
    return true;
  } catch (e) {
    alert(e.message);
    return false;
  }
}

// ---------- Adding a material ----------
const addDialog = $("source-dialog");

function renderCoursePicker(preferred) {
  const picker = $("source-course");
  const names = courseNames();
  picker.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  picker.value = names.includes(preferred) ? preferred : names.includes(nb.course) ? nb.course : names[0] || "";
  updateCourseRoom();
}

function updateCourseRoom() {
  const left = MAX_TOTAL_BYTES - usedBytes();
  $("course-room").textContent = left <= 0
    ? `Your library is full (${formatMB(MAX_TOTAL_BYTES)}). Remove a material to add another.`
    : `${formatMB(left)} of space left in your library`;
  $("source-submit").disabled = !$("source-course").value || left <= 0;
}

function openAddDialog(course) {
  if (courseNames().length === 0) {
    document.getElementById("add-open")?.click(); // materials belong to a class: add one first
    return;
  }
  $("source-form").reset();
  $("add-error").textContent = "";
  setMode(nb.mode);
  renderCoursePicker(course);
  updatePasteCount();
  addDialog.showModal();
}

function closeAddDialog() {
  addDialog.close();
}

function setMode(mode) {
  nb.mode = mode;
  addDialog.querySelectorAll(".nb-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active);
  });
  $("paste-field").hidden = mode !== "paste";
  $("file-field").hidden = mode !== "file";
  $("add-error").textContent = "";
}

function updatePasteCount() {
  const n = $("source-text").value.trim().length;
  const hint = $("paste-count");
  hint.textContent = `${n.toLocaleString()} / ${MAX_TEXT_CHARS.toLocaleString()} characters`;
  hint.classList.toggle("over", n > MAX_TEXT_CHARS);
}

function readFile(file, asDataUrl) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    asDataUrl ? reader.readAsDataURL(file) : reader.readAsText(file);
  });
}

async function addSource(e) {
  e.preventDefault();
  const error = $("add-error");
  const button = $("source-submit");
  error.textContent = "";

  let title = $("source-title").value.trim();
  const body = { course: $("source-course").value };
  if (!body.course) return (error.textContent = "Pick a class for it.");

  try {
    if (nb.mode === "paste") {
      const text = $("source-text").value.trim();
      if (!text) return (error.textContent = "Paste some notes first.");
      if (text.length > MAX_TEXT_CHARS) return (error.textContent = `Notes can be up to ${MAX_TEXT_CHARS.toLocaleString()} characters. Split them into parts.`);
      Object.assign(body, { type: "text", text });
    } else {
      const file = $("source-file").files[0];
      if (!file) return (error.textContent = "Choose a file first.");
      title ||= file.name.replace(/\.[^.]+$/, "");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) return (error.textContent = `That PDF is ${formatBytes(file.size)}. PDFs can be 5 MB max.`);
        const dataUrl = await readFile(file, true);
        Object.assign(body, { type: "pdf", data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
      } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) {
        const text = (await readFile(file, false)).trim();
        if (!text) return (error.textContent = "That file is empty.");
        if (text.length > MAX_TEXT_CHARS) return (error.textContent = `That file is too long. Notes can be up to ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
        Object.assign(body, { type: "text", text });
      } else {
        return (error.textContent = "Upload a .pdf, .txt or .md file.");
      }
    }
    if (!title) return (error.textContent = "Give it a title.");
    body.title = title;
    const size = body.type === "pdf" ? Math.floor(body.data.length * 3 / 4) : body.text.length;
    if (usedBytes() + size > MAX_TOTAL_BYTES) {
      return (error.textContent = `That won't fit: your library has ${formatMB(Math.max(0, MAX_TOTAL_BYTES - usedBytes()))} left. Remove something first.`);
    }

    button.disabled = true;
    button.textContent = "Adding…";
    const saved = await api("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    nb.sources.push(saved);
    nb.justAdded = saved.id;
    nb.collapsed.delete(saved.course);
    if (nb.course && nb.course !== saved.course) nb.course = saved.course; // show where it went
    closeAddDialog();
    renderAll();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = "Add material";
  }
}

// ---------- Viewing a material ----------
const viewer = $("source-viewer");

// Notes as a readable page: headings, lists, **bold**, paragraphs. Escaped first, so safe.
function renderNotes(text) {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let html = "";
  let list = null;
  let para = [];
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closePara = () => {
    if (!para.length) return;
    // A short line with no end punctuation, starting a block of text, reads as a heading
    if (para.length > 1 && para[0].length <= 60 && !/[.,;!?]$/.test(para[0].trim())) {
      html += `<h4>${inline(para.shift())}</h4>`;
    }
    html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };

  for (const line of escapeHtml(text).split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      closePara(); closeList();
      html += `<h4>${inline(m[1])}</h4>`;
    } else if ((m = line.match(/^\s*[-*•‣◦]\s+(.*)$/))) {
      closePara();
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      closePara();
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "") {
      closePara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  closePara(); closeList();
  return html || '<p class="nb-quiet">This material is empty.</p>';
}

async function openViewer(id) {
  const s = nb.sources.find((x) => x.id === id);
  if (!s) return;
  nb.viewing = id;

  const badge = $("viewer-badge");
  badge.className = "type-icon " + s.type;
  badge.innerHTML = ICONS[s.type] || ICONS.text;
  $("viewer-title").textContent = s.title;
  $("viewer-meta").textContent = [s.course || "Other", s.addedAt ? "Added " + formatDate(s.addedAt) : "", formatSize(s)]
    .filter(Boolean).join(" · ");
  $("viewer-use").checked = !nb.unchecked.has(id);

  const index = nb.order.indexOf(id);
  const many = index !== -1 && nb.order.length > 1;
  $("viewer-position").textContent = many ? `${index + 1} / ${nb.order.length}` : "";
  $("viewer-prev").hidden = $("viewer-next").hidden = !many;
  $("viewer-prev").disabled = index <= 0;
  $("viewer-next").disabled = index === nb.order.length - 1;

  const body = $("viewer-body");
  const openLink = $("viewer-open");
  const copy = $("viewer-copy");
  body.classList.toggle("is-pdf", s.type === "pdf");
  if (!viewer.open) viewer.showModal();
  body.scrollTop = 0;

  if (s.type === "pdf") {
    const url = `/api/sources/${encodeURIComponent(id)}/file`;
    body.innerHTML = `<iframe class="viewer-pdf" src="${url}" title="${escapeHtml(s.title)}"></iframe>`;
    openLink.href = url;
    openLink.hidden = false;
    copy.hidden = true;
    return;
  }

  openLink.hidden = true;
  copy.hidden = false;
  copy.disabled = true;
  if (!nb.texts.has(id)) {
    body.innerHTML = '<div class="nb-typing viewer-loading"><span></span><span></span><span></span></div>';
    try {
      const full = await api("/api/sources/" + encodeURIComponent(id));
      nb.texts.set(id, full.text || "");
    } catch (e) {
      if (nb.viewing === id) body.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
      return;
    }
  }
  if (nb.viewing !== id) return; // moved on while it loaded
  body.innerHTML = `<article class="viewer-notes">${renderNotes(nb.texts.get(id))}</article>`;
  copy.disabled = false;
}

function stepViewer(delta) {
  const next = nb.order[nb.order.indexOf(nb.viewing) + delta];
  if (next) openViewer(next);
}

viewer.addEventListener("close", () => {
  nb.viewing = null;
  $("viewer-body").innerHTML = ""; // unloads a PDF
});
$("viewer-close").onclick = () => viewer.close();
$("viewer-prev").onclick = () => stepViewer(-1);
$("viewer-next").onclick = () => stepViewer(1);
viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
viewer.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === "ArrowLeft") stepViewer(-1);
  if (e.key === "ArrowRight") stepViewer(1);
});
$("viewer-use").onchange = (e) => setUsed(nb.viewing, e.target.checked);

$("viewer-copy").onclick = async () => {
  const button = $("viewer-copy");
  try {
    await navigator.clipboard.writeText(nb.texts.get(nb.viewing) || "");
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
};

$("viewer-remove").onclick = async () => {
  const s = nb.sources.find((x) => x.id === nb.viewing);
  if (!s) return;
  const i = nb.order.indexOf(s.id);
  const neighbor = nb.order[i + 1] || nb.order[i - 1];
  if (!(await removeSource(s))) return;
  neighbor && nb.order.includes(neighbor) ? openViewer(neighbor) : viewer.close();
};

// "Ask about this": use only this material, then jump to the question box
$("viewer-ask").onclick = () => {
  const id = nb.viewing;
  const s = nb.sources.find((x) => x.id === id);
  if (s && nb.course && s.course !== nb.course) nb.course = s.course;
  visibleSources().forEach((x) => (x.id === id ? nb.unchecked.delete(x.id) : nb.unchecked.add(x.id)));
  viewer.close();
  renderAll();
  $("chat-title").scrollIntoView({ block: "start", behavior: "smooth" });
  $("question").focus({ preventScroll: true });
};

// ---------- What the assistant reads: "Using 3 of 4 materials" ----------
function renderContext() {
  const shown = visibleSources();
  const using = selectedSources().length;
  const button = $("source-pick");
  const where = nb.course || (courseNames().length > 1 ? "all classes" : "");
  button.innerHTML = shown.length === 0
    ? "No materials yet"
    : `<span class="context-dot${using ? "" : " off"}"></span>` +
      (using === shown.length ? `Using ${using === 1 ? "1 material" : `all ${shown.length} materials`}` : `Using ${using} of ${plural(shown.length, "material")}`) +
      (where ? ` <span class="context-where">· ${escapeHtml(where)}</span>` : "") + ` <span class="context-caret">${ICONS.chevron}</span>`;
  button.disabled = shown.length === 0;

  const menu = $("context-menu");
  if (!menu.hidden) renderContextMenu();
  updateAskState();
  if (!nb.chatId && !$("chat-log").querySelector(".msg")) renderWelcome();
}

function renderContextMenu() {
  const menu = $("context-menu");
  const shown = visibleSources();
  menu.innerHTML = `<div class="context-menu-head"><span>Answer from</span>` +
    `<button type="button" class="nb-text-button" data-all>${selectedSources().length === shown.length ? "None" : "All"}</button></div>`;
  for (const s of shown) {
    const label = document.createElement("label");
    label.className = "context-item";
    label.innerHTML = `<input type="checkbox"${nb.unchecked.has(s.id) ? "" : " checked"}>` +
      `<span class="type-icon small ${s.type}">${ICONS[s.type] || ICONS.text}</span>` +
      `<span class="context-item-title">${escapeHtml(s.title)}</span>`;
    label.querySelector("input").onchange = (e) => setUsed(s.id, e.target.checked);
    menu.appendChild(label);
  }
  menu.querySelector("[data-all]").onclick = () => {
    const all = selectedSources().length === shown.length;
    shown.forEach((s) => (all ? nb.unchecked.add(s.id) : nb.unchecked.delete(s.id)));
    renderLibrary();
    renderContext();
  };
}

function toggleContextMenu(force) {
  const menu = $("context-menu");
  const open = force ?? menu.hidden;
  menu.hidden = !open;
  $("source-pick").setAttribute("aria-expanded", String(open));
  if (open) renderContextMenu();
}

$("source-pick").onclick = () => toggleContextMenu();
document.addEventListener("click", (e) => {
  if (!$("context-menu").hidden && !e.target.closest(".composer-context")) toggleContextMenu(false);
});

// ---------- Turning the AI's answer into HTML ----------
// Headings, lists, **bold**, *italics* and ⟦n⟧ citation markers. Escaped first, so safe.
// LaTeX math ($x_0$, \frac{1}{2}) becomes plain text first (public/mathtext.js).
function renderAnswer(text, citations) {
  if (window.mathToText) text = window.mathToText(text);
  const byNumber = new Map(citations.map((c) => [String(c.n), c]));
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/⟦(\d+)⟧/g, (m, n) => {
      const c = byNumber.get(n);
      if (!c) return "";
      const tip = `${c.source}${c.page ? " (" + c.page + ")" : ""}: “${c.quote}”`;
      return `<button type="button" class="cite" data-n="${n}" title="${escapeHtml(tip)}">${n}</button>`;
    });

  let html = "";
  let list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const line of escapeHtml(text).split("\n")) {
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      closeList();
      html += `<h4>${inline(m[1])}</h4>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();

  if (citations.length) {
    html += '<details class="cited"><summary>' + plural(citations.length, "source") + "</summary><ol>" +
      citations.map((c) =>
        `<li id="cite-${c.n}"><strong>${escapeHtml(c.source)}</strong>` +
        `${c.page ? " · " + escapeHtml(c.page) : ""}<blockquote>${escapeHtml(c.quote)}</blockquote></li>`,
      ).join("") + "</ol></details>";
  }
  return html;
}

// ---------- Chat ----------
function addMessage(role, html, { reveal = false } = {}) {
  const log = $("chat-log");
  log.querySelector(".nb-welcome")?.remove();
  log.classList.add("has-messages");
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  if (role === "user") {
    msg.innerHTML = `<div class="msg-bubble">${html}</div>`;
  } else {
    msg.innerHTML = `<span class="msg-avatar" aria-hidden="true">✦</span><div class="msg-body${reveal ? " reveal" : ""}">${html}</div>`;
  }
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

// Fill an assistant message, letting its paragraphs ease in one after another
function setAnswer(msg, html, reveal) {
  const body = msg.querySelector(".msg-body");
  body.innerHTML = html;
  body.classList.toggle("reveal", reveal);
  if (reveal) [...body.children].forEach((el, i) => (el.style.animationDelay = `${Math.min(i, 12) * 70}ms`));
}

// The empty chat: a hello and a few ideas to start from
function renderWelcome() {
  const log = $("chat-log");
  log.classList.remove("has-messages");
  const count = selectedSources().length;
  const where = nb.course ? ` for ${escapeHtml(nb.course)}` : "";
  const greeting = !nb.sources.length
    ? "Hi! Add some notes or a PDF to your library, and I'll help you study from them."
    : count === 0
      ? "Pick at least one material below and I'll answer from it."
      : `Hi! I've got ${plural(count, "material")}${where} ready. What do you want to work on?`;
  log.innerHTML = `<div class="nb-welcome">
      <span class="nb-welcome-spark" aria-hidden="true">✦</span>
      <p class="nb-welcome-text">${greeting}</p>
      <div class="nb-starters"></div>
    </div>`;
  const box = log.querySelector(".nb-starters");
  if (!count || !nb.aiEnabled) return;
  for (const s of STARTERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nb-starter";
    b.innerHTML = `<span class="nb-starter-icon" aria-hidden="true">${s.icon}</span>` +
      `<span><strong>${s.title}</strong><small>${s.text}</small></span>`;
    b.onclick = () => ask(QUICK_PROMPTS[s.prompt], s.title);
    box.appendChild(b);
  }
}

// ---------- Saved chats ----------
const LAST_CHAT_KEY = "studysync-last-chat";

function rememberChat(id) {
  try { id ? localStorage.setItem(LAST_CHAT_KEY, id) : localStorage.removeItem(LAST_CHAT_KEY); } catch {}
}

function renderChatPicker() {
  const picker = $("chat-picker");
  const options = nb.chats.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.title)}</option>`);
  if (nb.chatId === null) options.unshift('<option value="">New chat</option>');
  picker.innerHTML = options.join("");
  picker.value = nb.chatId ?? "";
  picker.hidden = nb.chats.length === 0 && nb.chatId === null;
  $("delete-chat").hidden = nb.chatId === null;
  $("new-chat").disabled = nb.chatId === null;
}

function newChat() {
  nb.chatId = null;
  rememberChat(null);
  renderWelcome();
  renderChatPicker();
  updateAskState();
}

async function openChat(id) {
  try {
    const chat = await api("/api/chats/" + id);
    nb.chatId = chat.id;
    rememberChat(chat.id);
    $("chat-log").innerHTML = "";
    for (const m of chat.messages) {
      if (m.role === "user") addMessage("user", escapeHtml(m.label));
      else addMessage("assistant", renderAnswer(m.answer, m.citations));
    }
    renderChatPicker();
    updateAskState();
  } catch (e) {
    nb.chats = nb.chats.filter((c) => c.id !== id);
    newChat();
  }
}

async function deleteCurrentChat() {
  const chat = nb.chats.find((c) => c.id === nb.chatId);
  if (!chat || !confirm(`Delete the chat "${chat.title}"? This can't be undone.`)) return;
  try {
    await api("/api/chats/" + chat.id, { method: "DELETE" });
    nb.chats = nb.chats.filter((c) => c.id !== chat.id);
    newChat();
  } catch (e) {
    alert(e.message);
  }
}

function updateAskState() {
  const count = selectedSources().length;
  const ready = nb.aiEnabled && !nb.busy && count > 0;
  const q = $("question");
  $("ask-button").disabled = !ready || !q.value.trim();
  document.querySelectorAll(".chip-button, .nb-starter").forEach((b) => (b.disabled = !ready));
  // Quick actions sit above the box once a chat is going (the welcome has its own)
  $("composer-chips").hidden = !$("chat-log").querySelector(".msg");
  q.placeholder = !nb.aiEnabled
    ? "AI answers are off — see the note above"
    : count === 0
      ? "Add or pick a material to start…"
      : nb.chatId || $("chat-log").querySelector(".msg") ? "Ask a follow-up…" : "Ask anything about your materials…";
}

// Grow the question box with what's typed (up to a few lines)
function fitQuestion() {
  const q = $("question");
  q.style.height = "auto";
  q.style.height = Math.min(q.scrollHeight, 160) + "px";
  q.style.overflowY = q.scrollHeight > 160 ? "auto" : "hidden";
}

// label = what shows in the chat (quick actions show their name, not the full prompt)
async function ask(question, label = question) {
  question = question.trim();
  if (!question || nb.busy) return;
  const sources = selectedSources();
  if (sources.length === 0) return;

  nb.busy = true;
  nb.lastAsk = { question, label };
  toggleContextMenu(false);
  updateAskState();
  $("chat-picker").disabled = $("new-chat").disabled = $("delete-chat").disabled = true;
  addMessage("user", escapeHtml(label.trim()));
  const pending = addMessage("assistant",
    `<div class="nb-typing" aria-label="Thinking"><span></span><span></span><span></span></div>` +
    `<p class="nb-thinking-text">Reading ${plural(sources.length, "material")}…</p>`);

  try {
    const result = await api("/api/notebook/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, label, chatId: nb.chatId, sourceIds: sources.map((s) => s.id) }),
    });
    setAnswer(pending, renderAnswer(result.answer, result.citations), true);
    nb.chats = [result.chat, ...nb.chats.filter((c) => c.id !== result.chat.id)];
    nb.chatId = result.chat.id;
    rememberChat(nb.chatId);
  } catch (e) {
    pending.classList.add("failed");
    setAnswer(pending, `<p>${escapeHtml(e.message)}</p><button type="button" class="nb-text-button retry">Try again</button>`, false);
    pending.querySelector(".retry").onclick = () => {
      pending.previousElementSibling?.remove(); // the question, asked again below
      pending.remove();
      ask(nb.lastAsk.question, nb.lastAsk.label);
    };
  } finally {
    nb.busy = false;
    $("chat-picker").disabled = $("delete-chat").disabled = false;
    renderChatPicker();
    updateAskState();
    $("question").focus();
  }
}

// Clicking a citation number opens the source list and highlights that quote
$("chat-log").addEventListener("click", (e) => {
  const chip = e.target.closest(".cite");
  if (!chip) return;
  const msg = chip.closest(".msg");
  const details = msg.querySelector(".cited");
  const item = msg.querySelector("#cite-" + chip.dataset.n);
  if (!details || !item) return;
  details.open = true;
  msg.querySelectorAll(".cited li").forEach((li) => li.classList.remove("flash"));
  item.classList.add("flash");
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

// ---------- Drag and drop a file ----------
const dropZone = $("file-field");
const fileInput = $("source-file");

function showChosenFile() {
  const file = fileInput.files[0];
  $("drop-text").innerHTML = file
    ? `<strong>${escapeHtml(file.name)}</strong> · ${formatBytes(file.size)}<br><small>Drop or click to replace</small>`
    : "<strong>Drop a file here</strong> or click to choose one";
  dropZone.classList.toggle("has-file", Boolean(file));
  if (file && !$("source-title").value.trim()) $("source-title").placeholder = file.name.replace(/\.[^.]+$/, "");
}

fileInput.addEventListener("change", showChosenFile);
$("source-form").addEventListener("reset", () => setTimeout(() => {
  $("source-title").placeholder = "e.g. Lecture 5 – Hash tables";
  showChosenFile();
  updatePasteCount();
}));

["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (e) => {
  if (type === "dragleave" && dropZone.contains(e.relatedTarget)) return;
  dropZone.classList.remove("dragging");
}));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (!files.length) return;
  $("add-error").textContent = files.length > 1 ? "One file at a time — using the first one." : "";
  const one = new DataTransfer();
  one.items.add(files[0]);
  fileInput.files = one.files;
  showChosenFile();
});

// Dragging a file onto the Library opens the Add dialog
document.querySelector(".nb-library").addEventListener("dragenter", (e) => {
  if (!e.dataTransfer.types.includes("Files") || courseNames().length === 0) return;
  if (!addDialog.open) {
    nb.mode = "file";
    openAddDialog(nb.course);
  }
});

// Don't let a file dropped outside the zone open in the browser (which would leave the app)
["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => {
  if (e.dataTransfer?.types.includes("Files") && !dropZone.contains(e.target)) e.preventDefault();
}));

// ---------- Wiring it all up ----------
function renderAll() {
  renderCourseTabs();
  renderLibrary();
  renderContext();
}

addDialog.querySelectorAll(".nb-tab").forEach((tab) => (tab.onclick = () => setMode(tab.dataset.mode)));
$("source-form").addEventListener("submit", addSource);
$("source-open").onclick = () => openAddDialog(nb.course);
$("source-cancel").onclick = closeAddDialog;
addDialog.querySelector("[data-close]").onclick = closeAddDialog;
addDialog.addEventListener("click", (e) => { if (e.target === addDialog) closeAddDialog(); });
$("source-course").addEventListener("change", updateCourseRoom);
$("source-text").addEventListener("input", updatePasteCount);
$("drop-hint").textContent = `PDF, .txt or .md · PDFs up to ${MAX_PDF_BYTES / 1024 / 1024} MB`;

$("source-search").addEventListener("input", (e) => {
  nb.search = e.target.value;
  renderLibrary();
});

$("ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("question").value;
  if (!q.trim() || $("ask-button").disabled) return;
  $("question").value = "";
  fitQuestion();
  ask(q);
});

$("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("ask-form").requestSubmit();
  }
});
$("question").addEventListener("input", () => {
  fitQuestion();
  updateAskState();
});

document.querySelectorAll(".chip-button").forEach((b) => (b.onclick = () => ask(QUICK_PROMPTS[b.dataset.prompt], b.textContent)));
$("new-chat").onclick = newChat;
$("delete-chat").onclick = deleteCurrentChat;
$("chat-picker").addEventListener("change", (e) => (e.target.value ? openChat(e.target.value) : newChat()));

// The calendar tells us when classes change, so new classes show up right away
document.addEventListener("classes-changed", (e) => {
  nb.courses = e.detail.filter((c) => (c.kind || "class") === "class").map((c) => c.name);
  renderAll();
});

async function startNotebook() {
  newChat();
  try {
    const [sources, classes, status, savedChats] = await Promise.all([
      api("/api/sources"),
      api("/api/classes"),
      api("/api/notebook/status"),
      api("/api/chats"),
    ]);
    nb.chats = savedChats;
    nb.sources = sources;
    nb.courses = classes.filter((c) => (c.kind || "class") === "class").map((c) => c.name);
    nb.aiEnabled = status.aiEnabled;
    $("ai-off").hidden = nb.aiEnabled;
    $("ai-disclaimer").hidden = !status.freeTier;
    if (status.freeTier && window.addNoticeControls) {
      window.addNoticeControls($("ai-disclaimer"), { minimizeKey: "studysync-ai-disclaimer-minimized" });
    }
    renderAll();
    // Reopen the chat you had open last time, if it still exists
    let last = null;
    try { last = localStorage.getItem(LAST_CHAT_KEY); } catch {}
    if (last && nb.chats.some((c) => c.id === last)) await openChat(last);
    else { renderChatPicker(); renderWelcome(); updateAskState(); }
  } catch (e) {
    $("source-error").textContent = e.message;
    $("source-error").hidden = false;
  }
}

startNotebook();
