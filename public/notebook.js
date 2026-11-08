// StudySync - Course materials + Virtual Notebook (runs in the browser).
// Left side: the student's materials (notes, readings, PDFs), with "+ Add" to add more.
// Right side: ask the AI about the ticked materials. Course chips on top filter both.
// Talks to the server's /api/sources and /api/notebook routes.

const QUICK_PROMPTS = {
  summary: "Summarize the selected sources. Start with a short overview paragraph, then list the main points.",
  guide: "Make a study guide from the selected sources: the key concepts with short explanations, important terms, and what is most likely to show up on an exam.",
  quiz: "Quiz me: write 5 multiple-choice questions based on the selected sources. Put the answer key at the very end, with a one-line explanation for each answer.",
  terms: "List the key terms from the selected sources with a clear, short definition for each.",
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;

const nb = {
  sources: [],          // every saved source (from the server)
  courses: [],          // class names from the calendar
  course: "",           // which notebook is showing: "" = all courses, else a course name
  unchecked: new Set(), // sources the student unticked
  chats: [],            // saved chats for the dropdown: [{ id, title, updatedAt, questions }]
  chatId: null,         // the chat on screen (null = a new chat that isn't saved yet)
  aiEnabled: false,
  busy: false,
  mode: "file",         // "file" or "paste"
  justAdded: null,      // id of the material just added, to highlight it once
};

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

function formatSize(source) {
  if (source.type === "pdf") {
    return source.size < 1024 * 1024
      ? Math.max(1, Math.round(source.size / 1024)) + " KB"
      : (source.size / 1024 / 1024).toFixed(1) + " MB";
  }
  return source.size.toLocaleString() + " chars";
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Sources showing in the current notebook
function visibleSources() {
  if (nb.course === "") return nb.sources;
  return nb.sources.filter((s) => s.course === nb.course);
}

function selectedSources() {
  return visibleSources().filter((s) => !nb.unchecked.has(s.id));
}

// ---------- Courses: filter chips + the picker in the Add form ----------
function courseNames() {
  return [...new Set([...nb.courses, ...nb.sources.map((s) => s.course).filter(Boolean)])].sort();
}

function renderCourseOptions() {
  const names = courseNames();
  if (nb.course && !names.includes(nb.course)) nb.course = ""; // that course is gone
  if (names.length < 2) nb.course = "";                       // nothing to filter between

  // Chips: "All courses 5", "Biology 2", ... (only worth showing with 2+ courses)
  const row = $("nb-courses");
  row.innerHTML = "";
  row.hidden = names.length < 2;
  for (const value of ["", ...names]) {
    const count = value ? nb.sources.filter((s) => s.course === value).length : nb.sources.length;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "nb-course-chip";
    chip.setAttribute("aria-pressed", String(value === nb.course));
    chip.innerHTML = `${escapeHtml(value || "All courses")}<span class="chip-count">${count}</span>`;
    chip.onclick = () => {
      nb.course = value;
      renderCourseOptions(); // new materials default to the course you're viewing
      renderSources();
    };
    row.appendChild(chip);
  }

  // Course picker for new materials
  const picker = $("source-course");
  const keep = picker.value;
  picker.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  if (names.length) picker.value = names.includes(nb.course) ? nb.course : names.includes(keep) ? keep : names[0];
}

// ---------- Materials list ----------
function renderSources() {
  const list = $("source-list");
  const shown = visibleSources();
  list.innerHTML = "";
  $("source-count").textContent = shown.length || "";

  if (shown.length === 0) list.appendChild(emptyState());

  // Under "All courses", group by course (newest first inside each course)
  const grouped = nb.course === "" && new Set(shown.map((s) => s.course)).size > 1;
  const ordered = [...shown].sort((a, b) =>
    (grouped ? (a.course || "").localeCompare(b.course || "") : 0) || String(b.addedAt).localeCompare(String(a.addedAt)));

  let lastCourse = null;
  for (const s of ordered) {
    if (grouped && s.course !== lastCourse) {
      lastCourse = s.course;
      const heading = document.createElement("li");
      heading.className = "source-group";
      heading.textContent = s.course || "General";
      list.appendChild(heading);
    }
    list.appendChild(sourceItem(s));
  }
  nb.justAdded = null;
  updateAskState();
}

function sourceItem(s) {
  const li = document.createElement("li");
  li.className = "source-item" + (s.id === nb.justAdded ? " just-added" : "");

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !nb.unchecked.has(s.id);
  box.id = "src-" + s.id;
  box.onchange = () => {
    box.checked ? nb.unchecked.delete(s.id) : nb.unchecked.add(s.id);
    li.classList.toggle("unticked", !box.checked);
    updateAskState();
  };
  li.classList.toggle("unticked", !box.checked);

  const details = [formatSize(s), s.addedAt ? "added " + formatDate(s.addedAt) : ""].filter(Boolean).join(" · ");
  const label = document.createElement("label");
  label.htmlFor = box.id;
  label.innerHTML =
    `<span class="file-badge ${s.type}">${s.type === "pdf" ? "PDF" : "TXT"}</span>` +
    `<span class="source-text"><strong title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</strong>` +
    `<small>${escapeHtml(details)}</small></span>`;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Remove " + s.title;
  remove.setAttribute("aria-label", "Remove " + s.title);
  remove.onclick = () => removeSource(s);

  li.append(box, label, remove);
  return li;
}

// What shows when there's nothing in the list yet
function emptyState() {
  const li = document.createElement("li");
  li.className = "nb-empty-state";
  const hasCourses = courseNames().length > 0;
  const title = !hasCourses ? "Start with a class"
    : nb.course ? `No materials for ${nb.course} yet` : "No materials yet";
  const text = hasCourses
    ? "Add lecture notes, a reading or a PDF, then ask the AI about it."
    : "Add a class to your week first, then add its notes and readings here.";
  li.innerHTML = `<span class="nb-empty-icon" aria-hidden="true">📚</span>` +
    `<strong>${escapeHtml(title)}</strong><span>${text}</span>`;
  if ($("source-form").hidden) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = hasCourses ? "+ Add material" : "+ Add a class";
    button.onclick = openSourceForm;
    li.appendChild(button);
  }
  return li;
}

// "Using 3 of 4 · Use all" above the list
function updatePickLine() {
  const line = $("source-pick");
  const shown = visibleSources();
  const using = selectedSources().length;
  line.hidden = shown.length < 2;
  if (using === shown.length) {
    line.textContent = "The AI answers from the ticked materials. Untick any to leave them out.";
    return;
  }
  line.textContent = `Using ${using} of ${shown.length} in answers · `;
  const all = document.createElement("button");
  all.type = "button";
  all.className = "link-button";
  all.textContent = "Use all";
  all.onclick = () => {
    shown.forEach((s) => nb.unchecked.delete(s.id));
    renderSources();
  };
  line.appendChild(all);
}

async function removeSource(s) {
  if (!confirm(`Remove "${s.title}" from your notebook?`)) return;
  try {
    await api("/api/sources/" + s.id, { method: "DELETE" });
    nb.sources = nb.sources.filter((x) => x.id !== s.id);
    nb.unchecked.delete(s.id);
    renderCourseOptions();
    renderSources();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- Adding a material ----------
function openSourceForm() {
  if (courseNames().length === 0) {
    // Materials belong to a course, so send them to "Add to your week" first
    document.getElementById("add-open")?.click();
    return;
  }
  $("source-form").hidden = false;
  $("source-open").hidden = true;
  renderSources(); // drops the button from the empty message
  document.querySelector(".nb-tab.active").focus();
}

function closeSourceForm() {
  $("source-form").reset();
  $("source-form").hidden = true;
  $("source-open").hidden = false;
  $("source-error").textContent = "";
  renderSources();
}

function setMode(mode) {
  nb.mode = mode;
  document.querySelectorAll(".nb-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active);
  });
  $("paste-field").hidden = mode !== "paste";
  $("file-field").hidden = mode !== "file";
  $("source-error").textContent = "";
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
  const error = $("source-error");
  const button = $("source-submit");
  error.textContent = "";

  let title = $("source-title").value.trim();
  const body = { course: $("source-course").value };
  if (!body.course) return (error.textContent = "Pick a course for it.");

  try {
    if (nb.mode === "paste") {
      const text = $("source-text").value.trim();
      if (!text) return (error.textContent = "Paste some text first.");
      if (text.length > MAX_TEXT_CHARS) return (error.textContent = "That's too much text for one source. Split it into parts.");
      Object.assign(body, { type: "text", text });
    } else {
      const file = $("source-file").files[0];
      if (!file) return (error.textContent = "Choose a file first.");
      title ||= file.name.replace(/\.[^.]+$/, "");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) return (error.textContent = "PDFs can be 10 MB max.");
        const dataUrl = await readFile(file, true);
        Object.assign(body, { type: "pdf", data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
      } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/")) {
        const text = (await readFile(file, false)).trim();
        if (!text) return (error.textContent = "That file is empty.");
        if (text.length > MAX_TEXT_CHARS) return (error.textContent = "That file is too long for one source.");
        Object.assign(body, { type: "text", text });
      } else {
        return (error.textContent = "Upload a .pdf, .txt or .md file.");
      }
    }
    if (!title) return (error.textContent = "Give it a title.");
    body.title = title;

    button.disabled = true;
    button.textContent = "Adding…";
    const saved = await api("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    nb.sources.push(saved);
    nb.justAdded = saved.id;
    if (nb.course && nb.course !== saved.course) nb.course = saved.course; // show where it went
    renderCourseOptions();
    closeSourceForm();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = "Add material";
  }
}

// ---------- Turning the AI's answer into HTML ----------
// Handles the simple formatting we ask the AI for: headings, lists, **bold**, *italics*,
// plus ⟦n⟧ citation markers. Everything is escaped first, so it's safe to insert.
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
    html += '<details class="cited"><summary>Sources cited (' + citations.length + ")</summary><ol>" +
      citations.map((c) =>
        `<li id="cite-${c.n}"><strong>${escapeHtml(c.source)}</strong>` +
        `${c.page ? " · " + escapeHtml(c.page) : ""}<blockquote>${escapeHtml(c.quote)}</blockquote></li>`,
      ).join("") + "</ol></details>";
  }
  return html;
}

// ---------- Chat ----------
function addBubble(role, html) {
  const log = $("chat-log");
  log.querySelector(".nb-empty")?.remove();
  const bubble = document.createElement("div");
  bubble.className = "bubble " + role;
  bubble.innerHTML = html;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

// ---------- Saved chats ----------
const LAST_CHAT_KEY = "studysync-last-chat";

function rememberChat(id) {
  try { id ? localStorage.setItem(LAST_CHAT_KEY, id) : localStorage.removeItem(LAST_CHAT_KEY); } catch {}
}

function renderChatPicker() {
  const picker = $("chat-picker");
  const options = nb.chats.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.title)}${c.questions > 1 ? " (" + c.questions + ")" : ""}</option>`);
  if (nb.chatId === null) options.unshift('<option value="">New chat</option>');
  picker.innerHTML = options.join("");
  picker.value = nb.chatId ?? "";
  picker.hidden = nb.chats.length === 0 && nb.chatId === null; // nothing to switch to yet
  $("delete-chat").hidden = nb.chatId === null;
  $("new-chat").disabled = nb.chatId === null; // already on a fresh chat
}

// Start a fresh chat (it gets saved when you ask the first question)
function newChat() {
  nb.chatId = null;
  rememberChat(null);
  $("chat-log").innerHTML =
    '<p class="nb-empty"><span class="nb-empty-icon" aria-hidden="true">💬</span>' +
    "Ask anything about your ticked materials, or tap a button above to get started.<br>" +
    "Chats are saved, so you can come back to them from the menu.</p>";
  renderChatPicker();
}

// Show a saved chat
async function openChat(id) {
  try {
    const chat = await api("/api/chats/" + id);
    nb.chatId = chat.id;
    rememberChat(chat.id);
    $("chat-log").innerHTML = "";
    for (const m of chat.messages) {
      if (m.role === "user") addBubble("user", `<p>${escapeHtml(m.label)}</p>`);
      else addBubble("assistant", renderAnswer(m.answer, m.citations));
    }
    renderChatPicker();
  } catch (e) {
    nb.chats = nb.chats.filter((c) => c.id !== id); // it's gone (e.g. deleted elsewhere)
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
  updatePickLine();
  const ready = nb.aiEnabled && !nb.busy && selectedSources().length > 0;
  $("ask-button").disabled = !ready;
  document.querySelectorAll(".chip-button").forEach((b) => (b.disabled = !ready));
  $("question").placeholder = !nb.aiEnabled
    ? "AI answers are off — see the note above."
    : selectedSources().length === 0
      ? "Add or tick a material to start asking…"
      : `Ask about ${selectedSources().length} material${selectedSources().length === 1 ? "" : "s"}…`;
}

// label = what shows in the chat bubble (quick buttons show their name, not the full prompt)
async function ask(question, label = question) {
  question = question.trim();
  if (!question || nb.busy) return;
  const sources = selectedSources();
  if (sources.length === 0) return;

  nb.busy = true;
  updateAskState();
  $("chat-picker").disabled = $("new-chat").disabled = $("delete-chat").disabled = true; // don't switch mid-answer
  addBubble("user", `<p>${escapeHtml(label.trim())}</p>`);
  const pending = addBubble("assistant", '<p class="thinking"><span class="dot-spinner"></span>Reading your materials…</p>');

  try {
    const result = await api("/api/notebook/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, label, chatId: nb.chatId, sourceIds: sources.map((s) => s.id) }),
    });
    pending.innerHTML = renderAnswer(result.answer, result.citations);
    // Put this chat at the top of the dropdown (it was just updated)
    nb.chats = [result.chat, ...nb.chats.filter((c) => c.id !== result.chat.id)];
    nb.chatId = result.chat.id;
    rememberChat(nb.chatId);
  } catch (e) {
    pending.classList.add("failed");
    pending.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  } finally {
    nb.busy = false;
    $("chat-picker").disabled = $("delete-chat").disabled = false;
    renderChatPicker();
    updateAskState();
    $("question").focus();
  }
}

// Clicking a citation number opens the "Sources cited" list and highlights that quote
$("chat-log").addEventListener("click", (e) => {
  const chip = e.target.closest(".cite");
  if (!chip) return;
  const bubble = chip.closest(".bubble");
  const details = bubble.querySelector(".cited");
  const item = bubble.querySelector("#cite-" + chip.dataset.n);
  if (!details || !item) return;
  details.open = true;
  bubble.querySelectorAll(".cited li").forEach((li) => li.classList.remove("flash"));
  item.classList.add("flash");
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

// ---------- Drag and drop a file ----------
const dropZone = $("file-field");
const fileInput = $("source-file");

// Show which file is picked (or the default message if none)
function showChosenFile() {
  const file = fileInput.files[0];
  const size = file && (file.size < 1024 * 1024
    ? Math.max(1, Math.round(file.size / 1024)) + " KB"
    : (file.size / 1024 / 1024).toFixed(1) + " MB");
  $("drop-text").innerHTML = file
    ? `📄 <strong>${escapeHtml(file.name)}</strong> (${size}) · drop or click to replace`
    : "<strong>Drop a file here</strong> or click to choose one";
  dropZone.classList.toggle("has-file", Boolean(file));
}

fileInput.addEventListener("change", showChosenFile);
$("source-form").addEventListener("reset", () => setTimeout(showChosenFile)); // after the form clears

// Highlight the zone while a file is dragged over it
["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (e) => {
  if (type === "dragleave" && dropZone.contains(e.relatedTarget)) return; // still inside the zone
  dropZone.classList.remove("dragging");
}));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (!files.length) return;
  if (files.length > 1) $("source-error").textContent = "One file at a time — using the first one.";
  else $("source-error").textContent = "";
  const one = new DataTransfer();
  one.items.add(files[0]);
  fileInput.files = one.files;  // same as if it had been chosen with the picker
  showChosenFile();
});

// Dragging a file onto the Materials panel opens the Add form on "Upload a file"
document.querySelector(".nb-sources").addEventListener("dragenter", (e) => {
  if (!e.dataTransfer.types.includes("Files") || courseNames().length === 0) return;
  if ($("source-form").hidden) openSourceForm();
  if (nb.mode !== "file") setMode("file");
});

// Stop the browser from opening a file that misses the drop zone (which would leave the app)
["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => {
  if (e.dataTransfer?.types.includes("Files") && !dropZone.contains(e.target)) e.preventDefault();
}));

// ---------- Wiring it all up ----------
document.querySelectorAll(".nb-tab").forEach((tab) => (tab.onclick = () => setMode(tab.dataset.mode)));
$("source-form").addEventListener("submit", addSource);
$("source-open").onclick = openSourceForm;
$("source-cancel").onclick = closeSourceForm;
$("source-form").addEventListener("keydown", (e) => { if (e.key === "Escape") closeSourceForm(); });

$("ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("question").value;
  $("question").value = "";
  ask(q);
});

// Enter sends, Shift+Enter makes a new line
$("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("ask-form").requestSubmit();
  }
});

document.querySelectorAll(".chip-button").forEach((b) => (b.onclick = () => ask(QUICK_PROMPTS[b.dataset.prompt], b.textContent)));
$("new-chat").onclick = newChat;
$("delete-chat").onclick = deleteCurrentChat;
$("chat-picker").addEventListener("change", (e) => (e.target.value ? openChat(e.target.value) : newChat()));

// The calendar tells us when classes change, so new courses show up right away
document.addEventListener("classes-changed", (e) => {
  nb.courses = e.detail.map((c) => c.name);
  renderCourseOptions();
  renderSources(); // e.g. "Start with a class" changes once there's a class
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
    // Reopen the chat you had open last time, if it still exists
    let last = null;
    try { last = localStorage.getItem(LAST_CHAT_KEY); } catch {}
    if (last && nb.chats.some((c) => c.id === last)) await openChat(last);
    else renderChatPicker();
    nb.sources = sources;
    nb.courses = classes.filter((c) => (c.kind || "class") === "class").map((c) => c.name);
    nb.aiEnabled = status.aiEnabled;
    $("ai-off").hidden = nb.aiEnabled;
    $("ai-disclaimer").hidden = !status.freeTier;
    if (status.freeTier && window.addNoticeControls) {
      window.addNoticeControls($("ai-disclaimer"), { minimizeKey: "studysync-ai-disclaimer-minimized" });
    }
    renderCourseOptions();
    renderSources();
  } catch (e) {
    $("source-error").textContent = e.message;
  }
}

startNotebook();
