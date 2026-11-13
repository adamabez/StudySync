// StudySync - the live demo box on the welcome page (runs in the browser).
//
// One frame shows the real demo (demo.js) that visitors can scroll and click around in.
// The tabs above it jump to each part: the study groups page, or a section of the dashboard.
// Pages opened inside the frame stay in "embed" mode (no demo banner; see server.js), and
// links that leave the demo (sign up, log in, exit) open in the whole window (demo.js).
//
// On wide screens the page renders a little wider than the box and is scaled down slightly,
// so it looks like the desktop app but text stays readable and everything is clickable.
// On narrow screens it isn't scaled: the app's own phone layout fits the box.

(function () {
  const $ = (id) => document.getElementById(id);
  const preview = $("preview");
  if (!preview) return;

  const frame = $("preview-frame");
  const viewport = $("preview-viewport");
  const tabs = [...$("preview-tabs").querySelectorAll("button")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PATHS = { landing: "/landing", dashboard: "/dashboard" };

  let pendingTarget = null; // a section to scroll to once the dashboard has loaded
  let dashboardPrepared = false;

  // ---------- Size ----------

  function fit() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const pageWidth = width >= 560 ? Math.max(width, 900) : width; // desktop layout, at most ~25% smaller
    const scale = width / pageWidth;
    frame.style.width = pageWidth + "px";
    frame.style.height = Math.ceil(height / scale) + "px";
    frame.style.transform = scale < 1 ? `scale(${scale})` : "";
  }
  new ResizeObserver(fit).observe(viewport);
  fit();

  // ---------- Inside the frame ----------

  function frameDoc() {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  }

  function currentPage() {
    const doc = frameDoc();
    const path = doc && doc.location ? doc.location.pathname : "";
    return path.startsWith("/dashboard") ? "dashboard" : path.startsWith("/landing") ? "landing" : "";
  }

  function scrollToSection(selector) {
    const doc = frameDoc();
    if (!doc || !doc.defaultView) return;
    const el = selector ? doc.querySelector(selector) : null;
    const top = el ? el.getBoundingClientRect().top + doc.defaultView.scrollY - 16 : 0;
    doc.defaultView.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
  }

  // The dashboard as a visitor should first see it: homework and notebook open, the sample chat showing
  async function prepareDashboard() {
    const doc = frameDoc();
    if (!doc || dashboardPrepared) return;
    dashboardPrepared = true;
    for (const id of ["homework-body", "notebook-body"]) {
      const body = doc.getElementById(id);
      if (body) body.hidden = false;
    }
    try {
      const chats = await (await fetch("/api/chats")).json();
      const win = frame.contentWindow;
      if (chats[0] && typeof win.openChat === "function") setTimeout(() => win.openChat(chats[0].id), 600);
    } catch {
      // no sample chat: the notebook still shows its materials
    }
  }

  // Highlight the tab for what's showing (the visitor may have navigated by clicking inside)
  function markTab(page, target) {
    let match = tabs.find((t) => t.dataset.page === page && (t.dataset.target || null) === (target || null));
    if (!match) match = tabs.find((t) => t.dataset.page === page);
    tabs.forEach((t) => t.setAttribute("aria-current", String(t === match)));
  }

  // ---------- Tabs ----------

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const page = tab.dataset.page;
      const target = tab.dataset.target || null;
      markTab(page, target);
      if (currentPage() === page) {
        scrollToSection(target);
      } else {
        pendingTarget = target;
        $("preview-loading").hidden = false;
        frame.src = PATHS[page];
      }
    });
  });

  // ---------- Loading ----------

  frame.addEventListener("load", () => {
    $("preview-loading").hidden = true;
    frame.classList.add("active");
    const page = currentPage();
    if (page === "dashboard") {
      dashboardPrepared = false;
      prepareDashboard();
    }
    if (page) {
      const target = pendingTarget;
      pendingTarget = null;
      if (target) setTimeout(() => scrollToSection(target), 250); // after the page lays out
      markTab(page, target);
    }
  });

  frame.src = "/demo?embed=1&to=landing";
})();
