// StudySync - installing the site as an app ("Add to Home Screen"). Runs on every page.
//
// 1. Registers the service worker (public/sw.js, served at /sw.js), which makes the site
//    installable and shows an offline page.
// 2. Any element with data-install-app (the welcome page's button, "Get the app" in the
//    account menu) opens a small window that says this is an early version of the app
//    (a full App Store / Google Play app is coming) and then:
//      - Android, Windows and Mac in Chrome / Edge / Samsung Internet: an Install button that
//        opens the browser's own install dialog (browsers always ask to confirm)
//      - iPhone / iPad: Share, then Add to Home Screen (Apple doesn't let sites install themselves)
//      - Mac in Safari: File, then Add to Dock
//      - other computers: where Chrome / Edge keep their Install button
//    plus "On another device?" with short steps for Windows, Mac, iPhone and Android.
//    Those elements hide themselves once StudySync is opened as an installed app.

(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // not installable here (e.g. an old browser or private window): the site works the same
      });
    });
  }

  // ---------- What this device can do ----------
  let deferredPrompt = null; // Chrome / Edge hand this over when the site can be installed
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // no automatic banner: students choose with our button
    deferredPrompt = event;
  });

  const isInstalled = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const ua = navigator.userAgent;
  const isApple = () => /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMac = () => /Macintosh/.test(ua) && !isApple();
  const isMacSafari = () => isMac() && ua.includes("Safari/") && !["Chrome/", "Chromium/", "Edg/"].some((b) => ua.includes(b));
  const isComputer = () => !/Android|iPhone|iPad|iPod|Mobile/.test(ua) && !isApple();
  const isChromeOrEdge = () => ["Chrome/", "Edg/"].some((b) => ua.includes(b)) && !ua.includes("OPR/");

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    updateButtons();
    showDone();
  });

  function updateButtons() {
    const installed = isInstalled();
    for (const el of document.querySelectorAll("[data-install-app]")) el.hidden = installed;
  }

  // ---------- The window ----------
  // Short steps for every device, under "On another device?"
  const OTHER_DEVICES = `
    <details class="install-other">
      <summary>On another device?</summary>
      <dl>
        <dt>Windows</dt><dd>Open StudySync in <strong>Chrome</strong> or <strong>Edge</strong>, then click the install icon at the right of the address bar. It gets its own window and a Start menu icon.</dd>
        <dt>Mac</dt><dd>In <strong>Safari</strong>: File → <strong>Add to Dock</strong>. In <strong>Chrome</strong>: the install icon in the address bar.</dd>
        <dt>iPhone / iPad</dt><dd>In Safari: Share → <strong>Add to Home Screen</strong>.</dd>
        <dt>Android</dt><dd>In Chrome: menu ⋮ → <strong>Install app</strong>.</dd>
      </dl>
    </details>`;
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><polyline points="8 7 12 3 16 7"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  let dialog = null;

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "install-dialog";
    dialog.setAttribute("aria-labelledby", "install-title");
    dialog.innerHTML = `
      <button type="button" class="install-close" aria-label="Close">×</button>
      <img src="/public/icon-192.png" alt="" class="install-icon" width="64" height="64">
      <h2 id="install-title">Get the early app</h2>
      <p class="install-early"><strong>Early version.</strong> This puts StudySync on your home screen, Dock or
        Start menu so it opens like an app. Full apps for the App Store, Google Play, Windows and Mac are coming.</p>
      <div class="install-body"></div>
      ${OTHER_DEVICES}`;
    dialog.querySelector(".install-close").addEventListener("click", () => dialog.close());
    // Click outside the window closes it
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }

  function open() {
    if (!dialog) buildDialog();
    const body = dialog.querySelector(".install-body");
    if (deferredPrompt) {
      body.innerHTML = '<button type="button" class="install-go">Install StudySync</button>' +
        '<p class="install-note">Your browser will ask you to confirm.</p>';
      body.querySelector(".install-go").addEventListener("click", async () => {
        const prompt = deferredPrompt;
        deferredPrompt = null; // each one can only be used once
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (!choice || choice.outcome !== "accepted") dialog.close();
      });
    } else if (isMacSafari()) {
      body.innerHTML = `<ol class="install-steps">
          <li>In Safari's menu bar at the top of the screen, click <strong>File</strong>.</li>
          <li>Click <strong>Add to Dock</strong>, then <strong>Add</strong>.</li>
          <li>StudySync shows up in your Dock and Launchpad.</li>
        </ol>
        <p class="install-note">Needs macOS Sonoma or newer. On older Macs, use Chrome or Edge.</p>`;
    } else if (isComputer() && isChromeOrEdge()) {
      // Chrome / Edge on a computer that didn't offer the install here (already installed in
      // another profile, or the browser hasn't decided yet): where its own button is
      body.innerHTML = `<ol class="install-steps">
          <li>Click the <strong>install icon</strong> at the right end of the address bar (a computer screen with an arrow).</li>
          <li>No icon? Open the browser menu <strong>⋮</strong> → <strong>Cast, save and share</strong> (Chrome) or <strong>Apps</strong> (Edge) → <strong>Install StudySync</strong>.</li>
        </ol>
        <p class="install-note">It opens in its own window, with an icon in your ${isMac() ? "Dock" : "Start menu"}.</p>`;
    } else if (isApple()) {
      body.innerHTML = `<ol class="install-steps">
          <li>Tap <span class="install-share">${SHARE_ICON} Share</span> in your browser's toolbar.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. StudySync shows up with your other apps.</li>
        </ol>
        <p class="install-note">On iPhone and iPad, apps can only be added from the Share menu.</p>`;
    } else {
      body.innerHTML = '<p class="install-note">This browser can\'t install apps. Open StudySync in ' +
        "<strong>Chrome</strong> or <strong>Edge</strong> (Windows, Mac or Android), or <strong>Safari</strong> (iPhone or Mac), " +
        "and tap Get the app again.</p>";
    }
    dialog.showModal();
  }

  function showDone() {
    if (!dialog || !dialog.open) return;
    dialog.querySelector(".install-body").innerHTML =
      '<p class="install-note"><strong>Installed!</strong> Open StudySync from your home screen or app list.</p>';
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest && event.target.closest("[data-install-app]");
    if (!trigger) return;
    event.preventDefault();
    open();
  });

  updateButtons();
  document.addEventListener("DOMContentLoaded", updateButtons);
  window.studyInstall = { open, isInstalled };
})();
