// StudySync - the live preview next to the login form (runs in the browser).
//
// Two frames show the real demo (demo.js), scaled down: the study groups page and the
// dashboard. Every few seconds the preview moves to the next feature, scrolling the
// dashboard to it, so visitors see how StudySync works without clicking anything.
// Hovering pauses it; the dots jump to a step; clicking the screen opens the full demo.

(function () {
  const STEP_MS = 5500;

  // frame: which page shows it. target: what to scroll the dashboard to (null = top).
  const STEPS = [
    { frame: "landing", target: null, title: "Get matched with classmates", text: "No group-chat back-and-forth: a study group for each class, at a time everyone's free. (Early preview: still being tested.)" },
    { frame: "dashboard", target: ".week-heading", title: "Your whole week in one place", text: "Every Sac State class is built in: pick yours and the times fill in. More schools coming soon." },
    { frame: "dashboard", target: ".hw-head", title: "Homework, straight from Canvas", text: "Missing, upcoming and finished work, sorted for you." },
    { frame: "dashboard", target: ".nb-heading", title: "Ask AI about your own notes", text: "Answers come from your materials, with citations to check." },
  ];

  const $ = (id) => document.getElementById(id);
  const preview = $("preview");
  if (!preview) return;

  const frames = { landing: $("preview-landing"), dashboard: $("preview-dashboard") };
  const viewport = $("preview-viewport");
  const dots = $("preview-dots");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let step = 0;
  let timer = null;
  let paused = false;
  let ready = { landing: false, dashboard: false };

  // ---------- Scale the pages to fit ----------
  // The frames render at a real screen width (desktop, or phone on small screens) and are
  // shrunk to the preview's size, so the preview looks exactly like the app.

  function fit() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const pageWidth = width >= 520 ? 1180 : 420;
    const scale = width / pageWidth;
    for (const frame of Object.values(frames)) {
      frame.style.width = pageWidth + "px";
      frame.style.height = Math.ceil(height / scale) + "px";
      frame.style.transform = `scale(${scale})`;
    }
  }
  new ResizeObserver(fit).observe(viewport);
  fit();

  // ---------- Steps ----------

  STEPS.forEach((s, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "preview-dot";
    dot.setAttribute("aria-label", `Show: ${s.title}`);
    dot.addEventListener("click", () => {
      show(i);
      restart();
    });
    dots.appendChild(dot);
  });

  function frameDoc(name) {
    try {
      return frames[name].contentDocument;
    } catch {
      return null;
    }
  }

  function scrollTo(name, selector) {
    const doc = frameDoc(name);
    if (!doc || !doc.defaultView) return;
    const el = selector ? doc.querySelector(selector) : null;
    const top = el ? el.getBoundingClientRect().top + doc.defaultView.scrollY - 20 : 0;
    doc.defaultView.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
  }

  function show(i) {
    step = i;
    const s = STEPS[i];
    $("preview-title").textContent = s.title;
    $("preview-text").textContent = s.text;
    for (const [name, frame] of Object.entries(frames)) frame.classList.toggle("active", name === s.frame && ready[name]);
    $("preview-loading").hidden = ready[s.frame];
    [...dots.children].forEach((dot, n) => dot.setAttribute("aria-current", String(n === i)));
    if (ready[s.frame]) scrollTo(s.frame, s.target);
  }

  function next() {
    if (!paused && !document.hidden) show((step + 1) % STEPS.length);
  }

  function restart() {
    clearInterval(timer);
    timer = setInterval(next, STEP_MS);
  }

  // ---------- Swiping (phones and tablets) ----------
  // Swipe left / right on the screen for the next / previous step. A swipe isn't a tap,
  // so it doesn't open the demo; a plain tap still does.

  const screen = preview.querySelector(".preview-screen");
  const overlay = preview.querySelector(".preview-overlay");
  let touchStart = null;
  let justSwiped = false;

  screen.addEventListener("touchstart", (event) => {
    const t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  screen.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // a tap or a scroll
    justSwiped = true;
    setTimeout(() => (justSwiped = false), 400);
    show((step + (dx < 0 ? 1 : -1) + STEPS.length) % STEPS.length);
    restart(); // give them the full time on the step they swiped to
  }, { passive: true });

  overlay.addEventListener("click", (event) => {
    if (justSwiped) event.preventDefault();
  });

  // Hovering with a mouse, or tabbing in with the keyboard, pauses it. (Not taps: on phones a
  // tap also "hovers" and would pause it for good.)
  preview.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") paused = true; });
  preview.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") paused = false; });
  preview.addEventListener("focusin", (event) => { if (event.target.matches(":focus-visible")) paused = true; });
  preview.addEventListener("focusout", () => (paused = false));

  // ---------- Loading the demo into the frames ----------

  // The dashboard as a visitor should see it: sections open, the sample chat showing
  async function prepareDashboard() {
    const doc = frameDoc("dashboard");
    if (!doc) return;
    for (const id of ["homework-body", "notebook-body"]) {
      const body = doc.getElementById(id);
      if (body) body.hidden = false;
    }
    try {
      const chats = await (await fetch("/api/chats")).json();
      const win = frames.dashboard.contentWindow;
      if (chats[0] && typeof win.openChat === "function") setTimeout(() => win.openChat(chats[0].id), 600);
    } catch {
      // no sample chat: the notebook still shows its materials
    }
  }

  frames.landing.addEventListener("load", () => {
    ready.landing = true;
    show(step);
    // Load the dashboard second, so both frames share the demo the first one started
    if (!frames.dashboard.src) frames.dashboard.src = "/demo?embed=1&to=dashboard";
  });
  frames.dashboard.addEventListener("load", () => {
    ready.dashboard = true;
    prepareDashboard();
    restart();
  });

  frames.landing.src = "/demo?embed=1&to=landing";
  show(0);
})();
