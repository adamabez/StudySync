// StudySync - collapsible sections ("−" to minimize, "+" to bring back).
//
// To make any new section collapsible, add a button like this to its heading:
//   <button type="button" class="collapse-toggle" data-target="ID-OF-SECTION-BODY" data-name="My section">−</button>
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

function setCollapsed(button, collapsed) {
  const body = document.getElementById(button.dataset.target);
  if (!body) return;
  const name = button.dataset.name || "section";

  body.hidden = collapsed;
  button.textContent = collapsed ? "+" : "−";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-controls", body.id);
  button.setAttribute("aria-label", (collapsed ? "Expand " : "Minimize ") + name);
  button.title = collapsed ? "Expand" : "Minimize";
  button.closest(".section-head")?.classList.toggle("is-collapsed", collapsed);

  collapsed ? collapsedSections.add(body.id) : collapsedSections.delete(body.id);
  saveCollapsed(collapsedSections);
}

document.querySelectorAll(".collapse-toggle").forEach((button) => {
  setCollapsed(button, collapsedSections.has(button.dataset.target));
  button.addEventListener("click", () => {
    setCollapsed(button, button.getAttribute("aria-expanded") === "true");
  });
});
