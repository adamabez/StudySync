// StudySync - Virtual Notebook (runs in the browser).
// Left side: add/organize course materials. Right side: ask Claude about them.
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
  mode: "paste",        // "paste" or "file"
};

const $ = (id) => document.getElementById(id);

// ---------- Small helpers ----------
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
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

// ---------- Course dropdowns ----------
function renderCourseOptions() {
  const names = [...new Set([...nb.courses, ...nb.sources.map((s) => s.course).filter(Boolean)])].sort();

  const filter = $("nb-course");
  filter.innerHTML = '<option value="">All courses</option>' +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  filter.value = nb.course;
  if (filter.value !== nb.course) nb.course = filter.value = ""; // that notebook no longer exists

  // Course picker for new sources: only real courses (no "General")
  const picker = $("source-course");
  const keep = picker.value;
  picker.innerHTML = names.length
    ? names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")
    : '<option value="" disabled selected>Add a class to the calendar first</option>';
  if (names.length) picker.value = names.includes(nb.course) ? nb.course : names.includes(keep) ? keep : names[0];
}

// ---------- Source list ----------
function renderSources() {
  const list = $("source-list");
  const shown = visibleSources();
  list.innerHTML = "";

  if (shown.length === 0) {
    list.innerHTML = '<li class="nb-empty">No sources here yet. Add notes or a PDF above.</li>';
  }

  for (const s of shown) {
    const li = document.createElement("li");
    li.className = "source-item";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !nb.unchecked.has(s.id);
    box.id = "src-" + s.id;
    box.onchange = () => {
      box.checked ? nb.unchecked.delete(s.id) : nb.unchecked.add(s.id);
      updateAskState();
    };

    const label = document.createElement("label");
    label.htmlFor = box.id;
    label.innerHTML =
      `<span class="file-badge ${s.type}">${s.type === "pdf" ? "PDF" : "TXT"}</span>` +
      `<span class="source-text"><strong>${escapeHtml(s.title)}</strong>` +
      `<small>${escapeHtml(s.course || "General")} · ${formatSize(s)}</small></span>`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove " + s.title;
    remove.setAttribute("aria-label", "Remove " + s.title);
    remove.onclick = () => removeSource(s);

    li.append(box, label, remove);
    list.appendChild(li);
  }
  updateAskState();
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

// ---------- Adding a source ----------
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
  if (!body.course) return (error.textContent = "Pick a course. If the list is empty, add a class to the calendar first.");

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
    e.target.reset();
    renderCourseOptions();
    $("source-course").value = saved.course;
    renderSources();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = "Add source";
  }
}

// ---------- Turning Claude's answer into HTML ----------
// Handles the simple formatting we ask Claude for: headings, lists, **bold**, *italics*,
// plus ⟦n⟧ citation markers. Everything is escaped first, so it's safe to insert.
function renderAnswer(text, citations) {
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
    '<p class="nb-empty">Tick the sources you want to use, then ask a question or tap a button above. ' +
    "Every chat is saved, so you can switch back to it from the menu above.</p>";
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
  const ready = nb.aiEnabled && !nb.busy && selectedSources().length > 0;
  $("ask-button").disabled = !ready;
  document.querySelectorAll(".chip-button").forEach((b) => (b.disabled = !ready));
  $("question").placeholder = !nb.aiEnabled
    ? "AI answers are off — see the note above."
    : selectedSources().length === 0
      ? "Add or tick a source to start asking…"
      : `Ask about ${selectedSources().length} source${selectedSources().length === 1 ? "" : "s"}…`;
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
  const pending = addBubble("assistant", '<p class="thinking"><span class="dot-spinner"></span>Reading your sources…</p>');

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

// Dragging a file onto the Sources panel while on "Paste text" switches to "Upload file"
document.querySelector(".nb-sources").addEventListener("dragenter", (e) => {
  if (nb.mode !== "file" && e.dataTransfer.types.includes("Files")) setMode("file");
});

// Stop the browser from opening a file that misses the drop zone (which would leave the app)
["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => {
  if (e.dataTransfer?.types.includes("Files") && !dropZone.contains(e.target)) e.preventDefault();
}));

// ---------- Wiring it all up ----------
document.querySelectorAll(".nb-tab").forEach((tab) => (tab.onclick = () => setMode(tab.dataset.mode)));
$("source-form").addEventListener("submit", addSource);

$("nb-course").addEventListener("change", (e) => {
  nb.course = e.target.value;
  renderCourseOptions(); // new sources default to the notebook you're viewing
  renderSources();
});

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
    renderCourseOptions();
    renderSources();
  } catch (e) {
    $("source-error").textContent = e.message;
  }
}

startNotebook();
