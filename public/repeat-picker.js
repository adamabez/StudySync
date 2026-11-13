// StudySync - "Every week" vs "One time" for schedule items (runs in the browser).
//
// window.studyDates: helpers for one-time items (item.date = "2026-11-15"), on every page
// that shows the week. window.repeatPicker: the "Every week / One time" switch in the Add
// form (dashboard and setup page). Classes always repeat, so it only shows for tasks and
// "other". One time swaps the day buttons for a date.

(function () {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fromIso = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d); };

  function weekRange(now = new Date()) {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { from: iso(monday), to: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
  }

  window.studyDates = {
    today: () => iso(new Date()),
    // Weekly items, and one-time items happening this week (Mon–Sun)
    inThisWeek(date) {
      const { from, to } = weekRange();
      return date >= from && date <= to;
    },
    thisWeek: (items) => items.filter((item) => !item.date || window.studyDates.inThisWeek(item.date)),
    isPast: (date) => date < iso(new Date()),
    dayKey: (date) => DAY_KEYS[(fromIso(date).getDay() + 6) % 7],
    // "Sat, Nov 15"
    label: (date) => fromIso(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
  };

  // ---------- The switch in the Add form ----------
  const form = document.getElementById("add-form");
  const days = form && form.querySelector(".days");
  if (!days) return;

  const picker = document.createElement("div");
  picker.className = "repeat-picker";
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", "How often?");
  picker.innerHTML =
    '<label><input type="radio" name="repeat" value="weekly" checked><span>↻ Every week</span></label>' +
    '<label><input type="radio" name="repeat" value="once"><span>📅 One time</span></label>';
  const dateField = document.createElement("label");
  dateField.className = "once-date";
  dateField.innerHTML = '<span>Date</span><input type="date" id="once-date">';
  days.prepend(picker, dateField);
  const dateInput = dateField.querySelector("input");

  function kind() {
    const select = document.getElementById("kind");
    if (select) return select.value;
    const radio = document.querySelector('input[name="kind"]:checked');
    return radio ? radio.value : "class";
  }
  const isOnce = () => kind() !== "class" && picker.querySelector('input[value="once"]').checked;

  function update() {
    const canRepeat = kind() !== "class";
    picker.hidden = !canRepeat;
    const once = isOnce();
    form.classList.toggle("is-once", once);
    dateField.hidden = !once;
    dateInput.required = once;
    if (once && !dateInput.value) dateInput.value = iso(new Date());
    // No past dates for new items, but editing one that already happened still saves
    const today = iso(new Date());
    dateInput.min = dateInput.value && dateInput.value < today ? dateInput.value : today;
  }

  picker.addEventListener("change", update);
  document.addEventListener("change", (event) => {
    if (event.target.matches('#kind, input[name="kind"]')) update();
  });
  form.addEventListener("reset", () => setTimeout(() => { picker.querySelector('input[value="weekly"]').checked = true; dateInput.value = ""; update(); }));

  window.repeatPicker = {
    isOnce,
    // What to send with the item: { repeat: "once", date } or { repeat: "weekly" }
    value: () => (isOnce() ? { repeat: "once", date: dateInput.value } : { repeat: "weekly" }),
    // Editing an item: show how it repeats
    set(item) {
      picker.querySelector('input[value="' + (item.date ? "once" : "weekly") + '"]').checked = true;
      dateInput.value = item.date || "";
      update();
    },
    reset() {
      picker.querySelector('input[value="weekly"]').checked = true;
      dateInput.value = "";
      update();
    },
    update,
  };
  update();
})();
