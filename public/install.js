// StudySync - installing the site as an app (home screen, Dock or Start menu). Runs on every page.
//
// 1. Registers the service worker (public/sw.js, served at /sw.js), which makes the site
//    installable and shows an offline page.
// 2. Buttons with data-install-app open a small window that says this is an early version
//    (full app store / desktop apps are coming), then says how to install it:
//      data-install-app="phone"     the phone app (welcome and sign-up pages)
//      data-install-app="computer"  the computer app (welcome and sign-up pages)
//      data-install-app             this device, whichever it is (the account menu)
//    On the device the button is for, it installs here and now:
//      - Chrome / Edge / Samsung Internet (Android, Windows, Mac): an Install button that opens
//        the browser's own install dialog (browsers always ask to confirm)
//      - iPhone / iPad: Share, then Add to Home Screen (Apple doesn't let sites install themselves)
//      - Mac Safari: File, then Add to Dock
//      - Chrome / Edge on a computer that didn't offer it: where the browser's own button is
//    On the other kind of device (the phone button on a laptop), it says what to do over
//    there, with the address to open.
//    The buttons (and boxes marked data-install-app-box) hide once StudySync is opened as an installed app.

(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // not installable here (e.g. an old browser or private window): the site works the same
      });
    });
  }

  // ---------- What this device is and can do ----------
  let deferredPrompt = null; // Chrome / Edge hand this over when the site can be installed
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // no automatic banner: students choose with our buttons
    deferredPrompt = event;
  });

  const ua = navigator.userAgent;
  const has = (...names) => names.some((name) => ua.includes(name));
  const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isApple = () => has("iPhone", "iPad", "iPod") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isPhone = () => isApple() || has("Android", "Mobile");
  const isMac = () => has("Macintosh") && !isApple();
  const isMacSafari = () => isMac() && has("Safari/") && !has("Chrome/", "Chromium/", "Edg/");
  const isChromeOrEdge = () => has("Chrome/", "Edg/") && !has("OPR/");

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    updateButtons();
    showDone();
  });

  function updateButtons() {
    const installed = isInstalled();
    for (const el of document.querySelectorAll("[data-install-app], [data-install-app-box]")) el.hidden = installed;
  }

  // ---------- What the window says ----------
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><polyline points="8 7 12 3 16 7"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const address = () => location.host;

  const TEXT = {
    phone: {
      title: "Get the early phone app",
      early: "<strong>Early version.</strong> This puts StudySync on your home screen so it opens like an app. Full apps for the App Store and Google Play are coming.",
    },
    computer: {
      title: "Get the early computer app",
      early: "<strong>Early version.</strong> This opens StudySync in its own window, with an icon in your Dock or Start menu. Full Windows and Mac apps are coming.",
    },
  };

  // On this device, right now
  function installHere() {
    if (deferredPrompt) {
      return { html: '<button type="button" class="install-go">Install StudySync</button><p class="install-note">Your browser will ask you to confirm.</p>', prompt: true };
    }
    if (isApple()) {
      return { html: `<ol class="install-steps">
          <li>Tap <span class="install-share">${SHARE_ICON} Share</span> in your browser's toolbar.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. StudySync shows up with your other apps.</li>
        </ol>
        <p class="install-note">On iPhone and iPad, apps can only be added from the Share menu.</p>` };
    }
    if (isMacSafari()) {
      return { html: `<ol class="install-steps">
          <li>In Safari's menu bar at the top of the screen, click <strong>File</strong>.</li>
          <li>Click <strong>Add to Dock</strong>, then <strong>Add</strong>.</li>
          <li>StudySync shows up in your Dock and Launchpad.</li>
        </ol>
        <p class="install-note">Needs macOS Sonoma or newer. On older Macs, use Chrome or Edge.</p>` };
    }
    if (!isPhone() && isChromeOrEdge()) {
      return { html: `<ol class="install-steps">
          <li>Click the <strong>install icon</strong> at the right end of the address bar (a computer screen with an arrow).</li>
          <li>No icon? Open the browser menu <strong>⋮</strong> → <strong>Cast, save and share</strong> (Chrome) or <strong>Apps</strong> (Edge) → <strong>Install StudySync</strong>.</li>
        </ol>
        <p class="install-note">It opens in its own window, with an icon in your ${isMac() ? "Dock" : "Start menu"}.</p>` };
    }
    if (has("Android")) {
      return { html: `<ol class="install-steps">
          <li>Open the browser menu <strong>⋮</strong>.</li>
          <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
        </ol>
        <p class="install-note">Works best in Chrome or Samsung Internet.</p>` };
    }
    return { html: '<p class="install-note">This browser can\'t install apps. Open StudySync in <strong>Chrome</strong> or <strong>Edge</strong> ' +
      "(Windows, Mac or Android), or <strong>Safari</strong> (iPhone or Mac), and try again.</p>" };
  }

  // The other kind of device: what to do over there
  function installThere(target) {
    const open = `<p class="install-lead">On your ${target}, open <strong class="install-address">${address()}</strong>, then:</p>`;
    if (target === "phone") {
      return { html: open + `<dl class="install-list">
          <dt>iPhone</dt><dd>In Safari, tap Share → <strong>Add to Home Screen</strong>.</dd>
          <dt>Android</dt><dd>In Chrome, tap the menu ⋮ → <strong>Install app</strong>.</dd>
        </dl>` };
    }
    return { html: open + `<dl class="install-list">
        <dt>Windows</dt><dd>In <strong>Chrome</strong> or <strong>Edge</strong>, click the install icon at the right of the address bar.</dd>
        <dt>Mac</dt><dd>In <strong>Safari</strong>: File → <strong>Add to Dock</strong>. In <strong>Chrome</strong>: the install icon in the address bar.</dd>
      </dl>` };
  }

  // ---------- The window ----------
  let dialog = null;

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "install-dialog";
    dialog.setAttribute("aria-labelledby", "install-title");
    dialog.innerHTML = `
      <button type="button" class="install-close" aria-label="Close">×</button>
      <img src="/public/icon-192.png" alt="" class="install-icon" width="64" height="64">
      <h2 id="install-title"></h2>
      <p class="install-early"></p>
      <div class="install-body"></div>`;
    dialog.querySelector(".install-close").addEventListener("click", () => dialog.close());
    // Click outside the window closes it
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }

  // target: "phone", "computer", or "" for this device
  function open(target) {
    if (!dialog) buildDialog();
    const here = isPhone() ? "phone" : "computer";
    const kind = target === "phone" || target === "computer" ? target : here;
    dialog.querySelector("#install-title").textContent = TEXT[kind].title;
    dialog.querySelector(".install-early").innerHTML = TEXT[kind].early;
    const content = kind === here ? installHere() : installThere(kind);
    const body = dialog.querySelector(".install-body");
    body.innerHTML = content.html;
    if (content.prompt) {
      body.querySelector(".install-go").addEventListener("click", async () => {
        const prompt = deferredPrompt;
        deferredPrompt = null; // each one can only be used once
        if (!prompt) return;
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (!choice || choice.outcome !== "accepted") dialog.close();
      });
    }
    dialog.showModal();
  }

  function showDone() {
    if (!dialog || !dialog.open) return;
    dialog.querySelector(".install-body").innerHTML =
      '<p class="install-note"><strong>Installed!</strong> Open StudySync from your home screen, Dock or Start menu.</p>';
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest && event.target.closest("[data-install-app]");
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute("data-install-app"));
  });

  updateButtons();
  document.addEventListener("DOMContentLoaded", updateButtons);
  window.studyInstall = { open, isInstalled };
})();
