// StudySync - the class picker (runs in the browser, on the setup page and the dashboard).
// While adding a class, the name box opens a dropdown: every subject A-Z to browse (MATH →
// its classes), or, once you type, Sac State courses that match ("csc 2", "data struct",
// from /api/courses). Arrow keys + Enter, or click. Picking one means you're matched with everyone else
// in that class. A class that isn't in the catalog can still be typed in.
//
// Works with either form: the dashboard's "Add a…" dropdown (#kind) or the setup page's
// kind radio buttons (name="kind"). Only active while "class" is chosen.

(function () {
  const input = document.getElementById("name");
  if (!input) return;

  // The dropdown (our own, not a <datalist>: bigger, clickable rows)
  const menu = document.createElement("div");
  menu.id = "course-options";
  menu.className = "cp-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Sac State classes");
  menu.hidden = true;
  let active = -1;          // highlighted row
  let menuItems = [];       // [{ subject } | { course }] in the order shown
  let justPicked = false;   // don't reopen the menu right after picking
  let browsing = null;      // subject being browsed ("MATH"), or null
  let subjects = null;      // [{ subject, count }] once loaded
  const subjectCourses = new Map(); // "MATH" → its classes

  // The hint goes inside the class name's <label>, under the box: the Add form is a grid, and a
  // separate element would take a grid cell and push Starts / Ends into the wrong columns.
  const hint = document.createElement("span");
  hint.className = "course-hint";
  hint.hidden = true;
  hint.setAttribute("aria-live", "polite");
  const label = input.closest("label");
  if (label) label.appendChild(hint);
  else input.after(hint);
  (label || input.parentNode).appendChild(menu);
  if (label && getComputedStyle(label).position === "static") label.style.position = "relative";
  // Clicking in the menu shouldn't blur the box first (that would close it)
  menu.addEventListener("mousedown", (event) => event.preventDefault());

  let results = [];   // last suggestions from the server
  let searched = "";  // what they were for
  let timer = null;
  let request = 0;    // ignore answers to older searches
  let lastValue = input.value;

  // ---- Section dropdown: appears once the name is a catalog course with sections this term ----
  const form = input.form;
  const { DAY_SHORT, formatTime } = window.studyFormat; // public/format.js
  const sectionField = document.createElement("label");
  sectionField.className = "section-field";
  sectionField.hidden = true;
  sectionField.innerHTML = '<span class="section-label">Section</span>';
  const sectionSelect = document.createElement("select");
  sectionSelect.id = "section";
  const sectionNote = document.createElement("span");
  sectionNote.className = "section-note";
  // The <select> keeps track of the pick; people click the cards instead
  sectionSelect.hidden = true;
  sectionSelect.tabIndex = -1;
  const sectionCards = document.createElement("div");
  sectionCards.className = "cp-sections";
  sectionCards.setAttribute("role", "radiogroup");
  sectionCards.setAttribute("aria-label", "Your section");
  sectionField.append(sectionSelect, sectionCards, sectionNote);
  (input.closest("label") || input).after(sectionField);

  let sectionCode = "";   // course the dropdown is showing sections for
  let sectionList = [];
  let sectionTerm = "";
  let chosen = null;      // { code, id } once a section is picked (cleared if they change the times)
  let filling = false;    // true while we fill in the form ourselves
  const sectionCache = new Map();

  function isClass() {
    const select = document.getElementById("kind");
    if (select) return select.value === "class";
    const radio = document.querySelector('input[name="kind"]:checked');
    return !radio || radio.value === "class";
  }

  // Same rules as courses.js / normalize_course(): "csc20 - 01" → "CSC 20"
  function normalize(name) {
    const s = String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
    const m = s.match(/^([A-Z&]{1,8})(?: ?\/ ?[A-Z&]{1,8})* ?([0-9]{1,3}[A-Z]{0,3})(?: ?-.*| SEC.*| \(.*)?$/);
    return m ? m[1] + " " + m[2] : s;
  }

  const describeBlock = (b) => b.days.map((d) => DAY_SHORT[d]).join(", ") + " " + formatTime(b.start) + "–" + formatTime(b.end);

  function sectionLabel(s) {
    const parts = [s.id];
    if (s.component) parts.push(s.component);
    parts.push(s.blocks.length ? s.blocks.map(describeBlock).join(" + ") : "Online, no set time");
    const room = s.blocks.map((b) => b.where).find(Boolean);
    if (room) parts.push(room);
    if (s.mode && s.mode !== "In Person" && s.blocks.length) parts.push(s.mode);
    if (s.instructor) parts.push(s.instructor);
    return parts.join(" · ");
  }

  function clearSections() {
    sectionCode = "";
    sectionList = [];
    chosen = null;
    sectionSelect.innerHTML = "";
    sectionCards.innerHTML = "";
    sectionNote.textContent = "";
    showSectionField(false);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // One clickable card per section: "Sec 01 · Discussion", the times, then room · instructor
  function renderSectionCards() {
    sectionCards.innerHTML = "";
    for (const s of sectionList) {
      const card = el("button", "cp-section");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.dataset.id = s.id;
      const top = el("span", "cp-section-top");
      top.append(el("span", "cp-section-id", "Sec " + s.id));
      if (s.component) top.append(el("span", "cp-section-kind", s.component));
      card.append(top);
      card.append(el("span", "cp-section-time", s.blocks.length ? s.blocks.map(describeBlock).join(" + ") : "Online, no set time"));
      const meta = [];
      const room = s.blocks.map((b) => b.where).find(Boolean);
      if (room) meta.push(room);
      if (s.mode && s.mode !== "In Person" && s.blocks.length) meta.push(s.mode);
      if (s.instructor) meta.push(s.instructor);
      if (meta.length) card.append(el("span", "cp-section-meta", meta.join(" · ")));
      card.addEventListener("click", () => {
        sectionSelect.value = sectionSelect.value === s.id ? "" : s.id; // click again to unpick
        sectionSelect.dispatchEvent(new Event("change"));
      });
      sectionCards.append(card);
    }
    markSectionCards();
  }

  function markSectionCards() {
    for (const card of sectionCards.children) {
      const on = card.dataset.id === sectionSelect.value;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-checked", String(on));
    }
  }

  function showSectionField(on) {
    sectionField.hidden = !on;
    if (form) form.classList.toggle("has-sections", on);
  }

  // Load the sections for a course (once per course per page visit)
  async function loadSections(code) {
    if (code === sectionCode) return;
    clearSections();
    sectionCode = code;
    try {
      if (!sectionCache.has(code)) {
        sectionCache.set(code, fetch("/api/courses/sections?code=" + encodeURIComponent(code)).then((r) => (r.ok ? r.json() : null)));
      }
      const data = await sectionCache.get(code);
      if (sectionCode !== code) return; // they typed something else meanwhile
      if (!data || !Array.isArray(data.sections) || !data.sections.length) {
        sectionCache.delete(code);
        return;
      }
      sectionList = data.sections;
      sectionTerm = data.termLabel || "";
      sectionSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = `Pick your section to fill in the days and times (${sectionTerm})`;
      sectionSelect.appendChild(placeholder);
      for (const s of sectionList) {
        const option = document.createElement("option");
        option.value = s.id;
        option.textContent = sectionLabel(s);
        sectionSelect.appendChild(option);
      }
      sectionField.querySelector(".section-label").textContent = "Pick your section (" + sectionTerm + ") to fill in the days and times";
      renderSectionCards();
      showSectionField(isClass());
    } catch {
      sectionCache.delete(code);
    }
  }

  // Fill the form from the picked section: days, start / end, room (or "Asynchronous" if online)
  function fillFromSection(section) {
    if (!form) return;
    filling = true;
    const first = section.blocks[0];
    const asyncBox = document.getElementById("async");
    if (asyncBox && asyncBox.checked !== !first) {
      asyncBox.checked = !first;
      asyncBox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const box of form.querySelectorAll('.days input[type="checkbox"]')) box.checked = Boolean(first && first.days.includes(box.value));
    if (first) {
      document.getElementById("start").value = first.start;
      document.getElementById("end").value = first.end;
    }
    const room = section.blocks.map((b) => b.where).find(Boolean);
    const location = document.getElementById("location");
    if (location && room) location.value = room;
    filling = false;

    const extra = section.blocks.slice(1).map(describeBlock);
    sectionNote.textContent = "Filled in from the " + sectionTerm + " class schedule." +
      (extra.length ? " Also meets " + extra.join(" and ") + ", which will be added too." : "") +
      (!first ? " It's online with no set meeting time." : "");
  }

  sectionSelect.addEventListener("change", () => {
    const section = sectionList.find((s) => s.id === sectionSelect.value);
    chosen = section ? { code: sectionCode, id: section.id } : null;
    if (section) fillFromSection(section);
    else sectionNote.textContent = "";
    markSectionCards();
  });

  // Changing the days or times by hand means it's no longer exactly that section
  if (form) {
    form.addEventListener("input", (event) => {
      if (filling || !chosen || !event.target.matches("#start, #end, #async, .days input")) return;
      chosen = null;
      sectionSelect.value = "";
      markSectionCards();
      sectionNote.textContent = "Changed by hand, so the section's times won't be used.";
    });
    form.addEventListener("change", (event) => {
      if (filling || !chosen || !event.target.matches("#async, .days input")) return;
      chosen = null;
      sectionSelect.value = "";
      markSectionCards();
      sectionNote.textContent = "Changed by hand, so the section's times won't be used.";
    });
  }

  // For the forms: the picked section to send with the class, if it still matches the name
  window.coursePicker = {
    sectionFor(name) {
      return chosen && normalize(name) === chosen.code ? chosen.id : "";
    },
  };

  // When the hint hangs below the name box (wide screens), open up the gap under that row
  // by the hint's height so it doesn't cover the day buttons
  // (only above the row right under it, not between every row: --hint-room in style.css)
  function makeRoom() {
    const form = input.form;
    if (!form) return;
    form.style.removeProperty("--hint-room");
    if (hint.hidden || getComputedStyle(hint).position !== "absolute") return;
    form.style.setProperty("--hint-room", hint.offsetHeight + 4 + "px");
  }

  function showHint() {
    renderHint();
    makeRoom();
    // Sections: only for an exact catalog course, while adding a class
    const match = isClass() && searched === input.value.trim() && results.find((c) => c.code === normalize(input.value));
    if (match) loadSections(match.code);
    else if (!isClass() || normalize(input.value) !== sectionCode) clearSections();
    else showSectionField(isClass() && sectionList.length > 0);
  }

  function renderHint() {
    const value = input.value.trim();
    if (!isClass() || value.length < 2 || searched !== value) {
      hint.hidden = true;
      return;
    }
    const match = results.find((c) => c.code === normalize(value));
    hint.hidden = false;
    if (match) {
      // A chip: "✓ CSC 130  Data Structures", then what picking it means
      hint.className = "course-hint ok";
      hint.textContent = "";
      const chip = el("span", "cp-picked");
      chip.append(el("span", "cp-picked-check", "✓"), el("strong", "", match.code), el("span", "cp-picked-title", match.title));
      hint.append(chip, el("span", "cp-picked-note", "You'll be grouped with classmates in this class."));
    } else if (results.length) {
      hint.className = "course-hint";
      hint.textContent = "Pick your class from the list so you're matched with classmates.";
    } else {
      hint.className = "course-hint warn";
      hint.textContent = "Not in the Sac State catalog. You can still add it, but you'll only be grouped with students who type the same name.";
    }
  }

  async function search() {
    const value = input.value.trim();
    if (value.length < 2) {
      results = [];
      searched = value;
      if (document.activeElement === input && !justPicked) openMenu();
      showHint();
      return;
    }
    const mine = ++request;
    try {
      const res = await fetch("/api/courses?q=" + encodeURIComponent(value));
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      if (mine !== request) return;
      results = data;
      searched = value;
      if (justPicked) justPicked = false;
      else if (document.activeElement === input) openMenu();
    } catch {
      // Catalog not set up yet (or offline): plain text box, no hint
      results = [];
      searched = "";
      closeMenu();
    }
    showHint();
  }

  // ---------- The dropdown ----------
  // Empty box (or one letter): subjects A-Z to browse. A subject picked: its classes.
  // Two letters or more: classes matching what they typed.

  async function loadSubjects() {
    if (subjects) return subjects;
    try {
      const res = await fetch("/api/courses/subjects");
      subjects = res.ok ? await res.json() : [];
    } catch {
      subjects = [];
    }
    return subjects;
  }

  async function loadSubject(subject) {
    if (!subjectCourses.has(subject)) {
      subjectCourses.set(subject, fetch("/api/courses?subject=" + encodeURIComponent(subject)).then((r) => (r.ok ? r.json() : [])).catch(() => []));
    }
    const list = await subjectCourses.get(subject);
    if (!list.length) subjectCourses.delete(subject);
    return list;
  }

  function courseRow(course) {
    const row = el("div", "cp-option");
    row.append(el("span", "cp-code", course.code), el("span", "cp-title", course.title));
    if (course.units) row.append(el("span", "cp-units", course.units.replace(/ Units?$/i, " units").replace(/^1 units$/, "1 unit")));
    return row;
  }

  function addRow(row, item, grid) {
    const i = menuItems.length;
    row.id = "cp-option-" + i;
    row.setAttribute("role", "option");
    row.addEventListener("click", () => choose(item));
    row.addEventListener("mousemove", () => { if (active !== i) highlight(i, false); });
    menuItems.push(item);
    (grid || menu).append(row);
  }

  function startMenu() {
    menu.innerHTML = "";
    menuItems = [];
    active = -1;
  }

  function showMenu() {
    menu.style.top = input.offsetTop + input.offsetHeight + 6 + "px"; // right under the box
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  async function openMenu() {
    if (!isClass() || document.activeElement !== input) return closeMenu();
    const value = input.value.trim();

    if (browsing) {
      const subject = browsing;
      const list = await loadSubject(subject);
      if (browsing !== subject || document.activeElement !== input) return;
      startMenu();
      const head = el("div", "cp-head");
      const back = el("button", "cp-back", "← All subjects");
      back.type = "button";
      back.addEventListener("click", () => { browsing = null; openMenu(); });
      head.append(back, el("span", "cp-head-title", subject + " · " + list.length + (list.length === 1 ? " class" : " classes")));
      menu.append(head);
      for (const course of list) addRow(courseRow(course), { course });
      if (!list.length) menu.append(el("div", "cp-empty", "Couldn't load " + subject + " classes. Try typing the class instead."));
      showMenu();
      menu.scrollTop = 0;
      return;
    }

    if (value.length < 2) {
      const all = await loadSubjects();
      if (browsing || input.value.trim() !== value || document.activeElement !== input) return;
      if (!all.length) return closeMenu(); // catalog not set up: plain text box
      const letter = value.toUpperCase();
      const shown = all.filter((s) => s.subject.startsWith(letter));
      startMenu();
      const head = el("div", "cp-head");
      head.append(el("span", "cp-head-title", letter ? "Subjects starting with " + letter : "Browse by subject"),
        el("span", "cp-head-hint", "or type a class, like CSC 130"));
      menu.append(head);
      const grid = el("div", "cp-subjects");
      let lastLetter = "";
      for (const s of shown) {
        if (!letter && s.subject[0] !== lastLetter) {
          lastLetter = s.subject[0];
          grid.append(el("span", "cp-letter", lastLetter));
        }
        const chip = el("div", "cp-subject");
        chip.append(el("strong", "", s.subject), el("span", "cp-count", String(s.count)));
        chip.title = s.count + (s.count === 1 ? " class" : " classes");
        addRow(chip, { subject: s.subject }, grid);
      }
      menu.append(grid);
      if (!shown.length) menu.append(el("div", "cp-empty", "No subject starts with " + letter + "."));
      showMenu();
      return;
    }

    // Already exactly the one class they picked: nothing to suggest
    if (searched !== value) return;
    if (results.length === 1 && results[0].code === normalize(value)) return closeMenu();
    startMenu();
    for (const course of results.slice(0, 8)) addRow(courseRow(course), { course });
    if (!results.length) {
      const empty = el("div", "cp-empty");
      empty.append(el("strong", "", "No Sac State class matches \u201c" + value + "\u201d."), document.createTextNode(" You can still add it as typed."));
      menu.append(empty);
    } else if (results.length > 8) {
      menu.append(el("div", "cp-more", "Keep typing to narrow it down"));
    }
    showMenu();
  }

  function closeMenu() {
    menu.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function highlight(i, scroll = true) {
    active = i;
    menu.querySelectorAll('[role="option"]').forEach((row, j) => row.classList.toggle("active", j === i));
    const row = document.getElementById("cp-option-" + i);
    if (!row) return;
    input.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }

  function choose(item) {
    if (item.subject) {
      browsing = item.subject;
      openMenu();
      return;
    }
    closeMenu();
    browsing = null;
    justPicked = true;
    input.value = item.course.code;
    lastValue = input.value;
    clearTimeout(timer);
    search(); // updates the hint and loads the sections
  }

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", menu.id);
  input.setAttribute("aria-expanded", "false");

  input.addEventListener("keydown", (event) => {
    if (!isClass()) return;
    if (menu.hidden) {
      if (event.key === "ArrowDown") { event.preventDefault(); justPicked = false; openMenu(); }
      return;
    }
    const n = menuItems.length;
    if (event.key === "ArrowDown") { event.preventDefault(); if (n) highlight((active + 1) % n); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (n) highlight(active <= 0 ? n - 1 : active - 1); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(menuItems[active]); }
    else if (event.key === "Escape") { event.preventDefault(); if (browsing) { browsing = null; openMenu(); } else closeMenu(); }
    else if (event.key === "Backspace" && browsing && !input.value) { event.preventDefault(); browsing = null; openMenu(); }
  });
  input.addEventListener("focus", () => { justPicked = false; openMenu(); });
  input.addEventListener("click", () => { if (menu.hidden) { justPicked = false; openMenu(); } });
  input.addEventListener("blur", () => { closeMenu(); browsing = null; });

  function update() {
    if (isClass()) {
      // Keep browsers and password managers from offering saved names/addresses: Chrome
      // ignores autocomplete="off" on a box it thinks is a person's name (its id is "name"),
      // but leaves alone a field whose name and autocomplete it doesn't recognize
      input.setAttribute("autocomplete", "class-search");
      input.setAttribute("name", "class-search");
      input.setAttribute("data-lpignore", "true");   // LastPass
      input.setAttribute("data-1p-ignore", "");      // 1Password
      input.setAttribute("data-bwignore", "");       // Bitwarden
      input.setAttribute("data-form-type", "other"); // Dashlane
      if (input.value.trim().length >= 2 && searched !== input.value.trim()) search();
    } else {
      input.removeAttribute("autocomplete");
      input.removeAttribute("name");
      closeMenu();
    }
    showHint();
  }

  input.addEventListener("input", () => {
    lastValue = input.value;
    if (!isClass()) return;
    browsing = null;
    justPicked = false;
    clearTimeout(timer);
    if (input.value.trim().length < 2) search(); // subjects: no need to wait
    else timer = setTimeout(search, 180);
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('#kind, input[name="kind"]')) update();
  });
  // The forms also clear or fill the box themselves (after adding, or Edit): keep the hint in step
  setInterval(() => {
    if (input.value !== lastValue) {
      lastValue = input.value;
      update();
    }
  }, 400);

  window.addEventListener("resize", makeRoom);

  update();
})();
