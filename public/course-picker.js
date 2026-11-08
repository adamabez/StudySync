// StudySync - the class picker (runs in the browser, on the setup page and the dashboard).
// While adding a class, the name box suggests Sac State courses as you type ("csc 2",
// "data struct") from /api/courses. Picking one means you're matched with everyone else
// in that class. A class that isn't in the catalog can still be typed in.
//
// Works with either form: the dashboard's "Add a…" dropdown (#kind) or the setup page's
// kind radio buttons (name="kind"). Only active while "class" is chosen.

(function () {
  const input = document.getElementById("name");
  if (!input) return;

  const list = document.createElement("datalist");
  list.id = "course-options";
  document.body.appendChild(list);

  // The hint goes inside the class name's <label>, under the box: the Add form is a grid, and a
  // separate element would take a grid cell and push Starts / Ends into the wrong columns.
  const hint = document.createElement("span");
  hint.className = "course-hint";
  hint.hidden = true;
  hint.setAttribute("aria-live", "polite");
  const label = input.closest("label");
  if (label) label.appendChild(hint);
  else input.after(hint);

  let results = [];   // last suggestions from the server
  let searched = "";  // what they were for
  let timer = null;
  let request = 0;    // ignore answers to older searches
  let lastValue = input.value;

  // ---- Section dropdown: appears once the name is a catalog course with sections this term ----
  const form = input.form;
  const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const sectionField = document.createElement("label");
  sectionField.className = "section-field";
  sectionField.hidden = true;
  sectionField.innerHTML = '<span class="section-label">Section</span>';
  const sectionSelect = document.createElement("select");
  sectionSelect.id = "section";
  const sectionNote = document.createElement("span");
  sectionNote.className = "section-note";
  sectionField.append(sectionSelect, sectionNote);
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

  // "14:30" → "2:30 PM"
  function formatTime(t) {
    let [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + String(m).padStart(2, "0") + " " + ampm;
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
    sectionNote.textContent = "";
    showSectionField(false);
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
  });

  // Changing the days or times by hand means it's no longer exactly that section
  if (form) {
    form.addEventListener("input", (event) => {
      if (filling || !chosen || !event.target.matches("#start, #end, #async, .days input")) return;
      chosen = null;
      sectionSelect.value = "";
      sectionNote.textContent = "Changed by hand, so the section's times won't be used.";
    });
    form.addEventListener("change", (event) => {
      if (filling || !chosen || !event.target.matches("#async, .days input")) return;
      chosen = null;
      sectionSelect.value = "";
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
  function makeRoom() {
    const form = input.form;
    if (!form) return;
    form.style.rowGap = "";
    if (hint.hidden || getComputedStyle(hint).position !== "absolute") return;
    const gap = parseFloat(getComputedStyle(form).rowGap) || 12;
    form.style.rowGap = gap + hint.offsetHeight + 4 + "px";
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
      hint.className = "course-hint ok";
      hint.textContent = "✓ " + match.code + ": " + match.title + ". You'll be grouped with classmates in this class.";
    } else if (results.length) {
      hint.className = "course-hint";
      hint.textContent = "Pick your class from the suggestions so you're matched with classmates.";
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
      list.innerHTML = "";
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
      list.innerHTML = "";
      for (const course of data) {
        const option = document.createElement("option");
        option.value = course.code;
        option.label = course.title;
        option.textContent = course.title;
        list.appendChild(option);
      }
    } catch {
      // Catalog not set up yet (or offline): plain text box, no hint
      results = [];
      searched = "";
      list.innerHTML = "";
    }
    showHint();
  }

  function update() {
    if (isClass()) {
      input.setAttribute("list", "course-options");
      input.setAttribute("autocomplete", "off");
      if (input.value.trim().length >= 2 && searched !== input.value.trim()) search();
    } else {
      input.removeAttribute("list");
      input.removeAttribute("autocomplete");
    }
    showHint();
  }

  input.addEventListener("input", () => {
    lastValue = input.value;
    if (!isClass()) return;
    clearTimeout(timer);
    timer = setTimeout(search, 180);
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
