// StudySync - the little emoji on each day of the week (runs in the browser).
// Used by the dashboard's week (dashboard.js) and the study plan's week (landing.js).
//
//   📚  a day with classes
//   🏋️  a day with the gym or a sport ("Other" items like Gym, Soccer practice, Climbing)
//   rest days get their own emoji for each day of the week

(function () {
  const REST = { mon: "🌿", tue: "☕", wed: "🎧", thu: "🌙", fri: "🎉", sat: "🌴", sun: "🛋️" };

  // Gym / sports / exercise, from an "Other" item's category or name
  const WORKOUT = /\b(gym|sports?|work ?out|lift(ing)?|weights|climb(ing)?|bouldering|fitness|exercise|training|practice|soccer|basketball|football|baseball|softball|volleyball|tennis|swim(ming)?|running|run club|track|cross ?country|yoga|pilates|crossfit|boxing|martial arts|karate|jiu ?jitsu|wrestling|hockey|lacrosse|rugby|golf|cycling|spin|dance|cheer|intramurals?|athletics?)\b/i;

  const kindOf = (item) => item.kind || "class";
  const isWorkout = (item) => kindOf(item) === "other" && WORKOUT.test((item.category || "") + " " + (item.name || ""));
  const onDay = (item, key) => Array.isArray(item.days) && item.days.includes(key);

  window.dayEmoji = {
    rest: (key) => REST[key] || "🌿",
    isWorkout,
    // { classes, workout } for one day of someone's schedule
    of(items, key) {
      const today = items.filter((item) => onDay(item, key));
      return {
        classes: today.some((item) => kindOf(item) === "class"),
        workout: today.some(isWorkout),
      };
    },
    // "📚", "🏋️", "📚 🏋️" or "" for a day heading
    badges(items, key) {
      const { classes, workout } = this.of(items, key);
      return [classes && "📚", workout && "🏋️"].filter(Boolean).join(" ");
    },
  };
})();
