// StudySync - the "Early access" notices (runs in the browser).
//
// Login and sign-up (#ai-notice): only shown while the AI runs on Gemini's free tier
// (the server says so at /ai-status). Top right: – minimizes it to its title, × hides it
// for now (back on the next visit). "Don't show again" hides it for good in this browser.
//
// The notebook's notice (#ai-disclaimer) uses addNoticeControls() too, from notebook.js,
// with just the minimize button.

const DISMISSED_KEY = "studysync-ai-notice-dismissed";

function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked (e.g. private browsing)
  }
}

function writeFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // can't remember it: fine, it just won't stick
  }
}

function iconButton(label, text, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notice-btn " + className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = text;
  return button;
}

// Adds the top-right buttons to a notice. Everything after its <strong> title is wrapped
// so minimizing can hide it. Returns the controls box.
function addNoticeControls(box, { minimizeKey, closable = false } = {}) {
  if (box.querySelector(".notice-controls")) return; // already set up

  const title = box.querySelector("strong");
  const body = document.createElement("span");
  body.className = "notice-body";
  let node = title ? title.nextSibling : box.firstChild;
  while (node) {
    const next = node.nextSibling;
    body.appendChild(node);
    node = next;
  }
  box.appendChild(body);

  const controls = document.createElement("div");
  controls.className = "notice-controls";

  const minimize = iconButton("Minimize", "–", "notice-minimize");
  const setMinimized = (on) => {
    box.classList.toggle("minimized", on);
    minimize.textContent = on ? "+" : "–";
    minimize.title = on ? "Expand" : "Minimize";
    minimize.setAttribute("aria-label", on ? "Expand this notice" : "Minimize this notice");
    minimize.setAttribute("aria-expanded", String(!on));
  };
  minimize.addEventListener("click", () => {
    const on = !box.classList.contains("minimized");
    setMinimized(on);
    if (minimizeKey) writeFlag(minimizeKey, on);
  });
  setMinimized(minimizeKey ? readFlag(minimizeKey) : false);
  controls.appendChild(minimize);

  if (closable) {
    const close = iconButton("Dismiss this notice", "×", "notice-close");
    close.addEventListener("click", () => { box.hidden = true; }); // just this time
    controls.appendChild(close);
  }

  box.prepend(controls);
  return controls;
}
window.addNoticeControls = addNoticeControls;

// Login and sign-up
(async () => {
  const box = document.getElementById("ai-notice");
  if (!box || readFlag(DISMISSED_KEY)) return;
  try {
    const res = await fetch("/ai-status");
    if (!res.ok) return;
    const { freeTier } = await res.json();
    if (!freeTier) return;
  } catch {
    return; // can't tell: leave it hidden
  }

  addNoticeControls(box, { minimizeKey: "studysync-ai-notice-minimized", closable: true });

  const never = document.createElement("button");
  never.type = "button";
  never.className = "ai-notice-never";
  never.textContent = "Don't show again";
  never.addEventListener("click", () => {
    box.hidden = true;
    writeFlag(DISMISSED_KEY, true);
  });
  box.querySelector(".notice-body").append(never);
  box.hidden = false;
})();
