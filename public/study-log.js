// StudySync - "I studied" checkmarks on study sessions, and the weekly progress bar (runs in the browser).
// Used by the study plan page (landing.js) and the dashboard (dashboard.js).
// Saved by date through /api/study-log (studylog.js), so each week starts fresh.

(function () {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  // This week's dates by day, Monday first, in the student's own time zone: { mon: "2026-11-09", ... }
  function weekDates() {
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    return Object.fromEntries(DAY_KEYS.map((key, i) => [key, isoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))]));
  }

  const done = new Map(); // "2026-11-09|13:00" → minutes studied
  let ready = false;      // false until the database has the study_log table
  let drawers = [];       // { btn, draw } for each checkmark button
  const listeners = [];   // pages' own "something changed"

  // Buttons no longer on the page (their section was redrawn) are dropped
  const prune = () => { drawers = drawers.filter((d) => d.btn.isConnected); };
  const notify = () => { prune(); drawers.forEach((d) => d.draw()); drawProgress(); listeners.forEach((fn) => fn()); };

  const keyFor = (day, start) => weekDates()[day] + "|" + start;
  const isDone = (session) => done.has(keyFor(session.day, session.start));

  async function load() {
    const dates = weekDates();
    try {
      const res = await fetch("/api/study-log?from=" + dates.mon + "&to=" + dates.sun);
      if (!res.ok) return;
      const data = await res.json();
      ready = Boolean(data.ready);
      done.clear();
      for (const row of data.done || []) done.set(row.date + "|" + row.start, toMinutes(row.end) - toMinutes(row.start));
    } catch {
      // offline: no checkmarks this time
    }
    notify();
  }

  // Tick or untick a session; redraws straight away, and puts it back if saving fails
  async function set(session, on) {
    const key = keyFor(session.day, session.start);
    const change = (yes) => (yes ? done.set(key, toMinutes(session.end) - toMinutes(session.start)) : done.delete(key));
    change(on);
    notify();
    try {
      const res = await fetch("/api/study-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: weekDates()[session.day], start: session.start, end: session.end, done: on, kind: session.kind || "solo", groupId: session.groupId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      change(!on);
      notify();
    }
  }

  // A finished session: a filled green circle with a white checkmark (drawn, so it's sharp at any size)
  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // A round checkmark button for a session card ({ day, start, end, kind?, groupId? }).
  // labels: { off, on } (default "Mark done" / "Done")
  function button(session, labels = {}) {
    const offLabel = labels.off || "Mark done";
    const onLabel = labels.on || "Done";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "study-check";
    let shown = null; // only redraw when this button's own state changes (no re-animating every check)
    const draw = () => {
      const on = isDone(session);
      if (on === shown) return;
      shown = on;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.title = on ? "You studied this session. Click to undo." : "Click when you've studied this session";
      btn.innerHTML = '<span class="study-check-box" aria-hidden="true">' + (on ? CHECK_SVG : "") + "</span><span>" + (on ? onLabel : offLabel) + "</span>";
      btn.closest(".study-block, .study-time")?.classList.toggle("studied", on);
    };
    btn.addEventListener("click", (event) => {
      event.preventDefault();  // e.g. inside a group card that links to the group's page
      event.stopPropagation();
      const on = !isDone(session);
      btn.classList.toggle("pop", on); // the check pops in, only on the one just clicked
      set(session, on);
    });
    btn.addEventListener("animationend", () => btn.classList.remove("pop"));
    drawers.push({ btn, draw });
    queueMicrotask(draw); // once it's in the card
    return btn;
  }

  // ---------- Weekly progress bar ----------
  // Pages say where it goes (mount), the weekly goal (setGoal, minutes) and this week's
  // planned sessions (setPlanned). Studied time = everything checked off this week.
  let progressBox = null;
  let goalMinutes = 0;
  let planned = []; // [{ day, start, end }]

  function mount(container) {
    progressBox = container;
    container.classList.add("study-progress");
    container.hidden = true;
    container.innerHTML =
      '<div class="study-progress-text"><strong class="study-progress-title">This week</strong><span class="study-progress-detail"></span></div>' +
      '<div class="study-progress-track" role="progressbar" aria-label="Weekly study goal" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="study-progress-fill fill-group"></div><div class="study-progress-fill fill-solo"></div></div>';
    drawProgress();
  }

  function formatLength(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h && m ? h + "h " + m + "m" : h ? h + "h" : m + "m";
  }

  function drawProgress() {
    if (!progressBox) return;
    progressBox.hidden = !ready || (!goalMinutes && planned.length === 0);
    if (progressBox.hidden) return;
    const thisWeek = Object.values(weekDates());
    // Studied time split by group meetings vs solo (a checked session that's a planned group meeting counts as group)
    const groupKeys = new Set(planned.filter((s) => s.kind === "group").map((s) => keyFor(s.day, s.start)));
    let studiedGroup = 0;
    let studiedSolo = 0;
    for (const [key, min] of done.entries()) {
      if (!thisWeek.includes(key.split("|")[0])) continue;
      if (groupKeys.has(key)) studiedGroup += min;
      else studiedSolo += min;
    }
    const studied = studiedGroup + studiedSolo;
    const goal = goalMinutes || planned.reduce((sum, s) => sum + toMinutes(s.end) - toMinutes(s.start), 0);
    const percent = goal ? Math.min(100, Math.round((studied / goal) * 100)) : 0;
    const share = (min) => (goal ? Math.min(100, (min / goal) * 100) : 0);
    const reached = goal > 0 && studied >= goal;
    const doneCount = planned.filter(isDone).length;
    progressBox.classList.toggle("reached", reached);
    progressBox.querySelector(".study-progress-title").textContent = reached ? "🎉 Weekly goal reached!" : "This week's study goal";
    progressBox.querySelector(".study-progress-detail").textContent = formatLength(studied) + " of " + formatLength(goal) + " studied" +
      (planned.length ? " · " + doneCount + " of " + planned.length + (planned.length === 1 ? " session" : " sessions") : "");
    const groupWidth = share(studiedGroup);
    progressBox.querySelector(".fill-group").style.width = groupWidth + "%";
    progressBox.querySelector(".fill-solo").style.width = Math.min(100 - groupWidth, share(studiedSolo)) + "%";
    progressBox.querySelector(".study-progress-track").setAttribute("aria-valuenow", String(percent));
  }

  window.studyLog = {
    load,
    get ready() { return ready; },
    isDone,
    button,
    onChange: (fn) => listeners.push(fn),
    clearButtons: prune, // after a page redraws its cards
    progress: {
      mount,
      setGoal: (minutes) => { goalMinutes = minutes || 0; drawProgress(); },
      setPlanned: (sessions) => { planned = sessions || []; drawProgress(); },
    },
  };
})();
