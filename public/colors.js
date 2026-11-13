// StudySync - calendar colors (runs in the browser).
// ★ The ONLY place calendar colors are set: the dashboard's cards and color key, and the
// setup page's schedule list, all use this. Each kind has its own color family (hue range
// on the color wheel, in degrees), and every item gets its own shade inside it, by name.
// Color wheel: 0 red · 60 yellow · 120 green · 200 blue · 270 purple · 330 pink

(function () {
  const COLOR_FAMILIES = {
    class: { from: 110, span: 110 }, // greens → teals → blues
    task: { from: 335, span: 50 },   // pinks → reds → oranges
    other: { from: 255, span: 45 },  // violets → purples
  };

  // A color at some point inside a family's range (step 0 = start of the range)
  function familyColor(family, step) {
    return "hsl(" + ((family.from + step) % 360) + ", 60%, 48%)";
  }

  function colorFor(item) {
    const family = COLOR_FAMILIES[item.kind || "class"] || COLOR_FAMILIES.class;
    let hash = 0;
    for (const ch of item.name || "") hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    return familyColor(family, hash % family.span);
  }

  window.studyColors = { COLOR_FAMILIES, familyColor, colorFor };
})();
