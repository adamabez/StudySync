// StudySync - small text helpers shared by the browser scripts (load before them):
// window.studyFormat.formatTime("14:30") → "2:30 PM", and DAY_SHORT.mon → "Mon".

(function () {
  const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  // Turn "14:30" into "2:30 PM"
  function formatTime(t) {
    let [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + String(m).padStart(2, "0") + " " + ampm;
  }

  window.studyFormat = { DAY_SHORT, formatTime };
})();
