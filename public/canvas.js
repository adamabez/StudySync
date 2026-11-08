// StudySync - Homework from Canvas (the "Homework" section on the dashboard).
//
// Talks to the routes in canvas.js on the server:
//   GET    /api/canvas/status       → { connected, canvasUrl }
//   POST   /api/canvas/connect      → link Canvas with { canvasUrl, token }
//   DELETE /api/canvas/connect      → unlink
//   GET    /api/canvas/assignments  → { missing, completed, upcoming }
//
// Canvas text (assignment and course names) is always added with textContent,
// never innerHTML, so nothing from Canvas can run as code on this page.

(function () {
  const SHOW_AT_FIRST = 6; // items per column before "Show more"
  const SOON_MS = 48 * 60 * 60 * 1000; // upcoming work due within 2 days gets highlighted

  const els = {
    connectForm: document.getElementById("canvas-connect"),
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

  // ---------- Loading ----------

  async function loadHomework() {
    setStatus("Loading your homework from Canvas…");
    els.refresh.disabled = true;
    try {
      const data = await api("GET", "/api/canvas/assignments");
      drawColumn("missing", data.missing || []);
      drawColumn("upcoming", data.upcoming || []);
      drawColumn("completed", data.completed || []);
      setStatus("");
    } catch (error) {
      if (error.reconnect) return showConnectForm("Canvas stopped accepting your token. Make a new one and connect again.");
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

  els.connectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.connectError.textContent = "";
    els.connectButton.disabled = true;
    els.connectButton.textContent = "Checking with Canvas…";
    try {
      const result = await api("POST", "/api/canvas/connect", { canvasUrl: els.url.value, token: els.token.value });
      els.token.value = ""; // don't leave the token sitting in the page
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
      setStatus("");
      showConnectForm();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  start();
})();
