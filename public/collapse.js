// StudySync - collapsible sections (an arrow: points up to collapse, down to expand).
//
// To make any new section collapsible, add a button like this to its heading:
//   <button type="button" class="collapse-toggle" data-target="ID-OF-SECTION-BODY" data-name="My section"></button>
// and give the part you want to hide that id plus class="collapse-body".
//
// Your choice is remembered in this browser, so collapsed sections stay collapsed after a refresh.

const COLLAPSE_STORAGE_KEY = "studysync-collapsed";

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY)) || []);
  } catch {
    return new Set(); // storage blocked or empty → everything starts open
  }
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // storage blocked (e.g. private window) → it just won't be remembered
  }
}

const collapsedSections = loadCollapsed();

// The arrow inside each button. It points up; CSS turns it to point down when collapsed.
const ARROW_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path d="M3.5 10l4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function setCollapsed(button, collapsed) {
  const body = document.getElementById(button.dataset.target);
  if (!body) return;
  const name = button.dataset.name || "section";

  body.hidden = collapsed;
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-controls", body.id);
  button.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + name);
  button.title = collapsed ? "Expand" : "Collapse";
  button.closest(".section-head")?.classList.toggle("is-collapsed", collapsed);

  collapsed ? collapsedSections.add(body.id) : collapsedSections.delete(body.id);
  saveCollapsed(collapsedSections);
}

document.querySelectorAll(".collapse-toggle").forEach((button) => {
  button.innerHTML = ARROW_SVG;
  setCollapsed(button, collapsedSections.has(button.dataset.target));
  button.addEventListener("click", () => {
    setCollapsed(button, button.getAttribute("aria-expanded") === "true");
  });
});
