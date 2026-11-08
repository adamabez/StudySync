// StudySync - Homework from Canvas (the "Homework" section on the dashboard).
//
// Talks to the routes in canvas.js on the server:
//   GET    /api/canvas/status       → { connected, canvasUrl }
//   POST   /api/canvas/connect      → link Canvas with { canvasUrl, token }
//   DELETE /api/canvas/connect      → unlink
//   GET    /api/canvas/assignments  → { missing, completed, upcoming }
//   POST   /api/canvas/done         → tick a Calendar Feed assignment off (or untick it)
//
// Two ways to connect: a Calendar Feed link (works at every school, but students tick off
// finished work themselves) or an access token (if the school allows it).
//
// Canvas text (assignment and course names) is always added with textContent,
// never innerHTML, so nothing from Canvas can run as code on this page.

(function () {
  const SHOW_AT_FIRST = 6; // items per column before "Show more"
  const SOON_MS = 48 * 60 * 60 * 1000; // upcoming work due within 2 days gets highlighted
  let connectMode = "feed";   // which tab of the connect form is showing
  let homework = null;        // { missing, upcoming, completed } as last drawn

  const els = {
    connectForm: document.getElementById("canvas-connect"),
    feed: document.getElementById("canvas-feed"),
    feedFields: document.getElementById("canvas-feed-fields"),
    tokenFields: document.getElementById("canvas-token-fields"),
    tabs: document.querySelectorAll("[data-canvas-mode]"),
    url: document.getElementById("canvas-url"),
    token: document.getElementById("canvas-token"),
    connectButton: document.getElementById("canvas-connect-button"),
    connectError: document.getElementById("canvas-connect-error"),
    reconnectNote: document.getElementById("canvas-reconnect-note"),
    homework: document.getElementById("canvas-homework"),
    status: document.getElementById("canvas-status"),
    tools: document.getElementById("canvas-tools"),
    linkedTo: document.getElementById("canvas-linked-to"),
    refresh: document.getElementById("canvas-refresh"),
    unlink: document.getElementById("canvas-unlink"),
  };
  if (!els.connectForm) return; // not on the dashboard

  const COLUMNS = {
    missing: { list: document.getElementById("canvas-missing"), count: document.getElementById("canvas-missing-count"), empty: "Nothing missing. Nice work!" },
    upcoming: { list: document.getElementById("canvas-upcoming"), count: document.getElementById("canvas-upcoming-count"), empty: "Nothing due soon." },
    completed: { list: document.getElementById("canvas-completed"), count: document.getElementById("canvas-completed-count"), empty: "Nothing turned in yet." },
  };

  // ---------- Talking to the server ----------

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      window.location.href = "/"; // logged out of StudySync
      throw new Error("Not logged in");
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      // empty or not JSON
    }
    if (!res.ok) {
      const error = new Error(data.error || "Something went wrong. Try again.");
      error.reconnect = Boolean(data.reconnect);
      throw error;
    }
    return data;
  }

  // ---------- Showing one of the two states ----------

  function showConnectForm(message) {
    els.connectForm.hidden = false;
    els.homework.hidden = true;
    els.tools.hidden = true;
    els.reconnectNote.hidden = !message;
    els.reconnectNote.textContent = message || "";
  }

  function showHomework(canvasUrl) {
    els.connectForm.hidden = true;
    els.homework.hidden = false;
    els.tools.hidden = false;
    els.linkedTo.textContent = canvasUrl ? new URL(canvasUrl).hostname : "Canvas";
  }

  function setStatus(text, isError) {
    els.status.hidden = !text;
    els.status.textContent = text || "";
    els.status.classList.toggle("error", Boolean(isError));
  }

  // ---------- Dates ----------

  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  function dueText(dueAt, kind) {
    if (!dueAt) return "No due date";
    const formatted = dateFormat.format(new Date(dueAt));
    return kind === "missing" ? `Was due ${formatted}` : `Due ${formatted}`;
  }

  function safeLink(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  // ---------- Drawing the three columns ----------

  function itemElement(item, kind) {
    const li = document.createElement("li");
    li.className = `hw-item hw-${kind}`;
    if (kind === "upcoming" && item.dueAt && new Date(item.dueAt) - Date.now() < SOON_MS) li.classList.add("hw-soon");

    const href = safeLink(item.url);
    const name = document.createElement(href ? "a" : "span");
    name.className = "hw-name";
    name.textContent = item.name || "Untitled assignment";
    if (href) {
      name.href = href;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
      name.title = "Open in Canvas";
    }

    const meta = document.createElement("span");
    meta.className = "hw-meta";
    meta.textContent = [item.course, dueText(item.dueAt, kind)].filter(Boolean).join(" · ");

    if (item.checkable) {
      // Calendar Feed: the student ticks off finished work
      li.classList.add("hw-checkable");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "hw-check";
      box.checked = Boolean(item.done);
      box.setAttribute("aria-label", `${item.done ? "Mark as not done" : "Mark as done"}: ${item.name || "assignment"}`);
      box.addEventListener("change", () => setDone(item, box.checked, box));
      const text = document.createElement("span");
      text.className = "hw-text";
      text.append(name, meta);
      if (kind === "completed") {
        const note = document.createElement("span");
        note.className = "hw-done-note";
        note.textContent = "Ticked off";
        text.append(note);
      }
      li.append(box, text);
      return li;
    }

    li.append(name, meta);

    if (kind === "completed") {
      const score = document.createElement("span");
      score.className = "hw-score";
      if (typeof item.score === "number") {
        score.textContent = item.pointsPossible ? `${item.score} / ${item.pointsPossible}` : String(item.score);
      } else {
        score.textContent = "Not graded yet";
        score.classList.add("hw-ungraded");
      }
      li.append(score);
    }
    return li;
  }

  function drawColumn(kind, items) {
    const column = COLUMNS[kind];
    column.list.replaceChildren();
    column.count.textContent = items.length ? String(items.length) : "";

    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "hw-empty";
      empty.textContent = column.empty;
      column.list.append(empty);
      return;
    }

    items.slice(0, SHOW_AT_FIRST).forEach((item) => column.list.append(itemElement(item, kind)));
    if (items.length > SHOW_AT_FIRST) {
      const moreItem = document.createElement("li");
      const more = document.createElement("button");
      more.type = "button";
      more.className = "link-button hw-more";
      more.textContent = `Show ${items.length - SHOW_AT_FIRST} more`;
      more.addEventListener("click", () => {
        moreItem.remove();
        items.slice(SHOW_AT_FIRST).forEach((item) => column.list.append(itemElement(item, kind)));
      });
      moreItem.append(more);
      column.list.append(moreItem);
    }
  }

  function drawAll() {
    drawColumn("missing", homework.missing);
    drawColumn("upcoming", homework.upcoming);
    drawColumn("completed", homework.completed);
  }

  const byDue = (a, b) => (!a.dueAt ? 1 : !b.dueAt ? -1 : a.dueAt.localeCompare(b.dueAt));

  // Tick a Calendar Feed assignment off (or untick it): move it right away, then save
  async function setDone(item, done, box) {
    const before = JSON.parse(JSON.stringify(homework));
    for (const kind of Object.keys(homework)) homework[kind] = homework[kind].filter((i) => i.id !== item.id);
    const moved = { ...item, done };
    if (done) homework.completed = [moved, ...homework.completed].sort((a, b) => byDue(b, a));
    else if (item.dueAt && new Date(item.dueAt) < Date.now()) homework.missing = [...homework.missing, moved].sort(byDue);
    else homework.upcoming = [...homework.upcoming, moved].sort(byDue);
    drawAll();

    try {
      await api("POST", "/api/canvas/done", { id: item.id, done });
    } catch (error) {
      homework = before; // put it back where it was
      drawAll();
      setStatus(error.message, true);
    }
  }

  // ---------- Loading ----------

  async function loadHomework() {
    setStatus("Loading your homework from Canvas…");
    els.refresh.disabled = true;
    try {
      const data = await api("GET", "/api/canvas/assignments");
      homework = { missing: data.missing || [], upcoming: data.upcoming || [], completed: data.completed || [] };
      drawAll();
      setStatus("");
    } catch (error) {
      if (error.reconnect) return showConnectForm(`${error.message} Connect again to keep seeing your homework.`);
      setStatus(error.message, true);
    } finally {
      els.refresh.disabled = false;
    }
  }

  async function start() {
    try {
      const status = await api("GET", "/api/canvas/status");
      if (!status.connected) return showConnectForm();
      showHomework(status.canvasUrl);
      loadHomework();
    } catch (error) {
      showConnectForm();
      els.connectError.textContent = error.message;
    }
  }

  // ---------- Connect, refresh, unlink ----------

  function setConnectMode(mode) {
    connectMode = mode;
    els.tabs.forEach((tab) => {
      const active = tab.dataset.canvasMode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    els.feedFields.hidden = mode !== "feed";
    els.tokenFields.hidden = mode !== "token";
    els.connectError.textContent = "";
  }
  els.tabs.forEach((tab) => tab.addEventListener("click", () => setConnectMode(tab.dataset.canvasMode)));

  els.connectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.connectError.textContent = "";
    const body = connectMode === "feed"
      ? { feedUrl: els.feed.value.trim() }
      : { canvasUrl: els.url.value.trim(), token: els.token.value.trim() };
    if (connectMode === "feed" && !body.feedUrl) return (els.connectError.textContent = "Paste your Calendar Feed link.");
    if (connectMode === "token" && (!body.canvasUrl || !body.token)) return (els.connectError.textContent = "Enter your school's Canvas address and your token.");

    els.connectButton.disabled = true;
    els.connectButton.textContent = "Checking with Canvas…";
    try {
      const result = await api("POST", "/api/canvas/connect", body);
      els.token.value = ""; // don't leave secrets sitting in the page
      els.feed.value = "";
      showHomework(result.canvasUrl);
      loadHomework();
    } catch (error) {
      els.connectError.textContent = error.message;
    } finally {
      els.connectButton.disabled = false;
      els.connectButton.textContent = "Connect Canvas";
    }
  });

  els.refresh.addEventListener("click", loadHomework);

  els.unlink.addEventListener("click", async () => {
    if (!window.confirm("Unlink Canvas? Your homework will stop showing here. You can connect again any time.")) return;
    try {
      await api("DELETE", "/api/canvas/connect");
      Object.keys(COLUMNS).forEach((kind) => COLUMNS[kind].list.replaceChildren());
      homework = null;
      setStatus("");
      showConnectForm();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  start();
})();
