// StudySync - the "Early access" notices (runs in the browser).
//
// Login and sign-up (#ai-notice): only shown while the AI runs on Gemini's free tier
// (the server says so at /ai-status). Starts minimized to its title on every page load;
// + expands it (not remembered). It can't be dismissed for now: the × and "Don't show again" buttons are
// off, and an earlier "Don't show again" is ignored. Bring them back with NOTICE_DISMISSABLE.
//
// The notebook's notice (#ai-disclaimer) uses addNoticeControls() too, from notebook.js,
// with just the minimize button.

const DISMISSED_KEY = "studysync-ai-notice-dismissed";
const NOTICE_DISMISSABLE = false; // paused for now

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
// minimizedByDefault: start minimized until the person expands it (then remembered).
function addNoticeControls(box, { minimizeKey, closable = false, minimizedByDefault = false } = {}) {
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
    if (minimizeKey) {
      try { localStorage.setItem(minimizeKey, on ? "1" : "0"); } catch { /* won't stick: fine */ }
    }
  });
  let saved = null;
  try { saved = minimizeKey ? localStorage.getItem(minimizeKey) : null; } catch { /* storage blocked */ }
  setMinimized(saved === "1" ? true : saved === "0" ? false : minimizedByDefault);
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
  if (!box || (NOTICE_DISMISSABLE && readFlag(DISMISSED_KEY))) return;
  try {
    const res = await fetch("/ai-status");
    if (!res.ok) return;
    const { freeTier } = await res.json();
    if (!freeTier) return;
  } catch {
    return; // can't tell: leave it hidden
  }

  // No minimizeKey: it starts minimized on every page load, expanding isn't remembered
  addNoticeControls(box, { closable: NOTICE_DISMISSABLE, minimizedByDefault: true });

  if (NOTICE_DISMISSABLE) {
    const never = document.createElement("button");
    never.type = "button";
    never.className = "ai-notice-never";
    never.textContent = "Don't show again";
    never.addEventListener("click", () => {
      box.hidden = true;
      writeFlag(DISMISSED_KEY, true);
    });
    box.querySelector(".notice-body").append(never);
  }
  box.hidden = false;
})();
