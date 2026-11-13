// StudySync - the calendar page: the whole semester, a month at a time (runs in the browser).
//
// Classes and other weekly items repeat on their days from the first to the last day of classes
// (/api/term, lib/terms.js); classes and study group meetings skip holidays. One-time items show
// on their date. Solo study time is this week's plan, shown from this week on (it's planned a week
// at a time, so later weeks are "planned" and may shift).
//
// Below the month: the picked day's full list, and "Add to your calendar" (a private link for
// Google / Apple / Outlook; the feed itself is routes/calendar.js).

(function () {
  const { formatTime } = window.studyFormat;
  const { colorFor } = window.studyColors;
  const $ = (id) => document.getElementById(id);
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MAX_CHIPS = 3; // per day on a computer; phones show dots

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const dayKey = (d) => DAY_KEYS[(d.getDay() + 6) % 7];
  const today = iso(new Date());
  const thisMonday = (() => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))); })();
  const longDate = (s) => fromIso(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const shortDate = (s) => fromIso(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  let term = null;
  let items = [];      // calendar items (/api/classes)
  let study = [];      // group meetings + this week's solo sessions (/api/study-times)
  let holidays = new Map(); // date → name
  let shown = null;    // first day of the month on screen
  let picked = today;

  // ---------- What happens on a date ----------
  function eventsOn(date) {
    const d = fromIso(date);
    const key = dayKey(d);
    const inTerm = term && date >= term.start && date <= term.end;
    const holiday = holidays.get(date);
    const out = [];
    for (const item of items) {
      const kind = item.kind || "class";
      if (item.date) {
        if (item.date === date) out.push({ kind, name: item.name, start: item.start, end: item.end, note: item.location || item.category, once: true, color: colorFor(item) });
        continue;
      }
      if (!inTerm || !item.days.includes(key)) continue;
      if (kind === "class" && holiday) continue; // no classes on holidays
      out.push({ kind, name: item.name, start: item.start, end: item.end, note: kind === "class" ? item.location : item.category, color: colorFor(item) });
    }
    for (const s of study) {
      if (!inTerm || !s.days.includes(key)) continue;
      if (s.type === "group") {
        if (holiday) continue;
        out.push({ kind: "group", name: s.name, start: s.start, end: s.end, note: s.note });
      } else if (date >= thisMonday) {
        out.push({ kind: "study", name: "Study time", start: s.start, end: s.end, note: date >= addDays(thisMonday, 7) ? "Planned" : s.note });
      }
    }
    return out.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }

  function addDays(date, n) {
    const d = fromIso(date);
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  // ---------- The month ----------
  function renderMonth() {
    const grid = $("cal-grid");
    grid.innerHTML = "";
    $("cal-month").textContent = shown.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    for (const name of DAY_NAMES) {
      const head = document.createElement("div");
      head.className = "cal-weekday";
      head.setAttribute("role", "columnheader");
      head.textContent = name;
      grid.appendChild(head);
    }

    // Start on the Monday on or before the 1st, end on the Sunday on or after the last day
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const last = new Date(shown.getFullYear(), shown.getMonth() + 1, 0);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - ((last.getDay() + 6) % 7)));

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const date = iso(d);
      const events = eventsOn(date);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell";
      cell.setAttribute("role", "gridcell");
      if (d.getMonth() !== shown.getMonth()) cell.classList.add("other-month");
      if (term && (date < term.start || date > term.end)) cell.classList.add("out-of-term");
      if (date === today) cell.classList.add("today");
      if (date === picked) cell.setAttribute("aria-pressed", "true");
      const holiday = holidays.get(date);
      if (holiday) cell.classList.add("holiday");
      cell.setAttribute("aria-label", longDate(date) + (holiday ? ", " + holiday + ", no classes" : "") + ": " +
        (events.length === 1 ? "1 item" : events.length + " items"));

      const num = document.createElement("span");
      num.className = "cal-num";
      num.textContent = d.getDate();
      cell.appendChild(num);

      const label = holiday || (term && date === term.start ? "First day of classes" : term && date === term.end ? "Last day of classes" : "");
      if (label) {
        const tag = document.createElement("span");
        tag.className = "cal-label";
        tag.textContent = label;
        cell.appendChild(tag);
      }

      // Computers: a few chips with times. Phones: colored dots (CSS picks).
      const chips = document.createElement("span");
      chips.className = "cal-chips";
      for (const e of events.slice(0, MAX_CHIPS)) {
        const chip = document.createElement("span");
        chip.className = "cal-chip " + e.kind;
        if (e.color) chip.style.setProperty("--c", e.color);
        chip.textContent = (e.start ? formatTime(e.start).replace(":00", "").replace(" ", "").toLowerCase() + " " : "") + e.name;
        chips.appendChild(chip);
      }
      if (events.length > MAX_CHIPS) {
        const more = document.createElement("span");
        more.className = "cal-more";
        more.textContent = "+" + (events.length - MAX_CHIPS) + " more";
        chips.appendChild(more);
      }
      const dots = document.createElement("span");
      dots.className = "cal-dots";
      dots.setAttribute("aria-hidden", "true");
      for (const e of events.slice(0, 4)) {
        const dot = document.createElement("span");
        dot.className = "cal-dot " + e.kind;
        if (e.color) dot.style.setProperty("--c", e.color);
        dots.appendChild(dot);
      }
      cell.append(chips, dots);

      cell.addEventListener("click", () => pick(date));
      grid.appendChild(cell);
    }
  }

  // ---------- The picked day ----------
  function pick(date) {
    picked = date;
    for (const cell of document.querySelectorAll(".cal-cell[aria-pressed]")) cell.removeAttribute("aria-pressed");
    const d = fromIso(date);
    shown = new Date(d.getFullYear(), d.getMonth(), 1); // a day from next month jumps there
    renderMonth();
    renderDay();
  }

  function renderDay() {
    const box = $("cal-day");
    box.innerHTML = "";
    const title = document.createElement("h3");
    title.textContent = longDate(picked) + (picked === today ? " · Today" : "");
    box.appendChild(title);

    const holiday = holidays.get(picked);
    if (holiday) {
      const note = document.createElement("p");
      note.className = "cal-holiday-note";
      note.textContent = holiday + ": no classes.";
      box.appendChild(note);
    }
    const events = eventsOn(picked);
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = term && (picked < term.start || picked > term.end) ? "Outside the semester." : "Nothing planned.";
      box.appendChild(empty);
      return;
    }
    const list = document.createElement("ul");
    list.className = "cal-day-list";
    for (const e of events) {
      const li = document.createElement("li");
      li.className = "cal-day-item " + e.kind;
      if (e.color) li.style.setProperty("--c", e.color);
      const time = document.createElement("span");
      time.className = "cal-day-time";
      time.textContent = e.start ? formatTime(e.start) + " – " + formatTime(e.end) : "Any time";
      const name = document.createElement("strong");
      name.textContent = e.name;
      li.append(time, name);
      const extra = [e.kind === "study" ? "Study time, planned by StudySync" : e.kind === "group" ? "Study group" : "", e.once ? "One time" : "", e.note].filter(Boolean).join(" · ");
      if (extra) {
        const note = document.createElement("span");
        note.className = "cal-day-note";
        note.textContent = extra;
        li.appendChild(note);
      }
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  // ---------- Add to your calendar ----------
  async function loadFeed() {
    const res = await fetch("/api/calendar/link").catch(() => null);
    if (!res || !res.ok) return;
    const info = await res.json();
    const actions = $("cal-feed-actions");
    const note = $("cal-feed-note");
    $("cal-feed").hidden = false;
    actions.innerHTML = "";
    if (info.demo) {
      note.innerHTML = 'This is a demo, so there\'s no calendar to add. <a href="/signup">Create a free account</a> to get your own link.';
      return;
    }
    if (info.notSetUp) {
      note.textContent = "Calendar links aren't set up yet. Check back soon.";
      return;
    }
    const link = (href, text, cls) => { const a = document.createElement("a"); a.href = href; a.textContent = text; a.className = cls; if (/^https:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; } return a; };
    actions.append(
      link("https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(info.webcal), "Add to Google Calendar", "cal-feed-btn primary"),
      link(info.webcal, "Apple Calendar / Outlook", "cal-feed-btn"),
    );
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cal-feed-btn";
    copy.textContent = "Copy link";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(info.url); copy.textContent = "Copied!"; } catch { window.prompt("Copy this link:", info.url); }
      setTimeout(() => { copy.textContent = "Copy link"; }, 2000);
    });
    actions.appendChild(copy);
    note.innerHTML = "";
    note.append("Keep this link private: anyone with it can see your schedule. ");
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "link-button";
    reset.textContent = "Make a new link";
    reset.addEventListener("click", async () => {
      if (!window.confirm("Make a new link? The old one stops working, so calendars using it stop updating.")) return;
      const r = await fetch("/api/calendar/link/reset", { method: "POST" }).catch(() => null);
      if (r && r.ok) loadFeed();
    });
    note.appendChild(reset);
  }

  // ---------- Start ----------
  async function load() {
    const [termRes, classesRes, studyRes] = await Promise.all([fetch("/api/term"), fetch("/api/classes"), fetch("/api/study-times")]);
    if (classesRes.status === 401) return (window.location.href = "/login");
    term = termRes.ok ? await termRes.json() : null;
    items = classesRes.ok ? await classesRes.json() : [];
    study = studyRes.ok ? await studyRes.json() : [];
    holidays = new Map((term ? term.holidays : []).map((h) => [h.date, h.name]));
    if (term) $("term-line").textContent = term.label + " · Classes " + shortDate(term.start) + " – " + shortDate(term.end);
    const t = fromIso(today);
    shown = new Date(t.getFullYear(), t.getMonth(), 1);
    renderMonth();
    renderDay();
    loadFeed();
  }

  $("cal-prev").addEventListener("click", () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); renderMonth(); });
  $("cal-next").addEventListener("click", () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); renderMonth(); });
  $("cal-today").addEventListener("click", () => pick(today));

  load().catch(() => {
    $("cal-grid").innerHTML = '<p class="cal-loading">Couldn\'t load your calendar. Refresh to try again.</p>';
  });
})();
