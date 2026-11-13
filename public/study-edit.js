// StudySync - quick edits to this week's solo study sessions: the ✎ menu (runs in the browser).
// Used on the study plan page (landing.js) and the dashboard (dashboard.js).
//
// ✎ on a session → Move to another open time, change its length, or skip it this week.
// Edits only apply to this week (studyplan.js on the server checks and saves them).

(function () {
  const { DAY_SHORT, formatTime } = window.studyFormat; // public/format.js
  const PENCIL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11.2 2.3a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L5.6 12.9 2.5 13.5l.6-3.1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 3.5l2.5 2.5" stroke="currentColor" stroke-width="1.5"/></svg>';

  const formatLength = (min) => { const h = Math.floor(min / 60); const m = min % 60; return h && m ? h + "h " + m + "m" : h ? h + "h" : m + "m"; };
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text) n.textContent = text; return n; };

  let menu = null;      // the open menu
  let openFor = null;   // the ✎ button it belongs to

  function close() {
    if (!menu) return;
    menu.remove();
    if (openFor) { openFor.setAttribute("aria-expanded", "false"); openFor.focus({ preventScroll: true }); }
    menu = null;
    openFor = null;
  }
  document.addEventListener("click", (event) => { if (menu && !menu.contains(event.target) && event.target !== openFor) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);

  async function send(change) {
    const res = await fetch("/api/study-edits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) throw new Error(data.error || "Couldn't change that. Try again.");
  }

  // A small message at the bottom of the screen, with an optional Undo
  function toast(text, undo) {
    document.querySelector(".se-toast")?.remove();
    const box = el("div", "se-toast");
    box.setAttribute("role", "status");
    box.append(el("span", "", text));
    if (undo) {
      const button = el("button", "se-toast-undo", "Undo");
      button.type = "button";
      button.addEventListener("click", async () => { box.remove(); await undo(); });
      box.append(button);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 6000);
  }

  // session: { key, day, start, end, edited }; onChange(): redraw the page's plan
  function open(button, session, onChange) {
    close();
    openFor = button;
    button.setAttribute("aria-expanded", "true");
    menu = el("div", "se-menu");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Change this study session");
    const length = toMinutes(session.end) - toMinutes(session.start);
    menu.append(el("div", "se-title", DAY_SHORT[session.day] + " · " + formatTime(session.start) + " – " + formatTime(session.end)));
    const error = el("p", "se-error");
    const body = el("div", "se-body", "Finding open times…");
    menu.append(body, error);
    document.body.append(menu);
    place(button);

    const act = async (change, done) => {
      error.textContent = "";
      menu.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await send({ key: session.key, ...change });
        close();
        await onChange();
        if (done) done();
      } catch (e) {
        error.textContent = e.message;
        menu.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };

    fetch("/api/study-edits/options?key=" + encodeURIComponent(session.key))
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!menu) return;
        body.textContent = "";
        if (!ok) { error.textContent = data.error || "Couldn't load options."; return; }

        // Move to another open time
        body.append(el("div", "se-label", "Move to"));
        const moves = el("div", "se-moves");
        for (const m of data.moves) {
          const b = el("button", "se-move");
          b.type = "button";
          b.append(el("strong", "", DAY_SHORT[m.day]), el("span", "", formatTime(m.start) + " – " + formatTime(m.end)), el("em", "", m.label));
          b.addEventListener("click", () => act({ action: "move", day: m.day, start: m.start, end: m.end }, () => toast("Moved to " + DAY_SHORT[m.day] + " " + formatTime(m.start) + ".")));
          moves.append(b);
        }
        if (!data.moves.length) moves.append(el("p", "se-none", "No other open time this week."));
        body.append(moves);

        // Length
        body.append(el("div", "se-label", "Length"));
        const lengths = el("div", "se-lengths");
        for (const min of data.lengths) {
          const b = el("button", "se-length" + (min === length ? " current" : ""), formatLength(min));
          b.type = "button";
          if (min === length) b.setAttribute("aria-pressed", "true");
          else b.addEventListener("click", () => act({ action: "length", minutes: min }));
          lengths.append(b);
        }
        body.append(lengths);

        // Skip / reset
        const footer = el("div", "se-footer");
        const skip = el("button", "se-skip", "Skip this week");
        skip.type = "button";
        skip.addEventListener("click", () => act({ action: "skip" }, () => toast("Skipped " + DAY_SHORT[session.day] + " " + formatTime(session.start) + " this week.", () => send({ key: session.key, action: "reset" }).then(onChange).catch(() => {}))));
        footer.append(skip);
        if (session.edited) {
          const reset = el("button", "se-reset", "Reset to suggested");
          reset.type = "button";
          reset.addEventListener("click", () => act({ action: "reset" }));
          footer.append(reset);
        }
        body.append(footer);
        place(button);
        menu.querySelector("button")?.focus({ preventScroll: true });
      })
      .catch(() => { if (menu) { body.textContent = ""; error.textContent = "Couldn't load options. Try again."; } });
  }

  const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  // Next to the ✎ button, kept on screen
  function place(button) {
    if (!menu) return;
    const r = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  window.studyEdit = {
    // The ✎ button for a session card
    button(session, onChange) {
      const b = el("button", "se-button");
      b.type = "button";
      b.innerHTML = PENCIL;
      b.title = "Move, change length or skip";
      b.setAttribute("aria-label", "Change this study session");
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", (event) => {
        event.stopPropagation();
        if (openFor === b) return close();
        open(b, session, onChange);
      });
      return b;
    },
    // A "Skipped this week" line with Undo for each skipped session
    skippedNote(container, skipped, onChange) {
      container.innerHTML = "";
      container.hidden = !skipped.length;
      if (!skipped.length) return;
      container.append(el("span", "se-skipped-label", "Skipped this week:"));
      for (const s of skipped) {
        const chip = el("span", "se-skipped");
        chip.append(el("span", "", DAY_SHORT[s.day] + " " + formatTime(s.start)));
        const undo = el("button", "se-skipped-undo", "Undo");
        undo.type = "button";
        undo.addEventListener("click", async () => { undo.disabled = true; await send({ key: s.key, action: "reset" }).catch(() => {}); await onChange(); });
        chip.append(undo);
        container.append(chip);
      }
    },
  };
})();
