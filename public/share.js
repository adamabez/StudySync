// YoraBora - "Share YoraBora": a window with a QR code friends can scan to open the site.
// Runs on every page (loaded next to install.js).
//
// Any button or link with data-share-app opens it (the account menu, the welcome page).
// The window shows:
//   - a QR code for the site's address (made by the server: GET /share.json, routes/pages.js),
//     so a friend can point their phone camera at your screen
//   - Share…     the phone or computer's own share sheet (Messages, WhatsApp, AirDrop...), where the
//                browser has one
//   - Copy link  the address, to paste anywhere
//   - Save QR code  an image of the code, for a poster, slide or group chat

(function () {
  let dialog = null;
  let info = null; // { url, svg } from the server, fetched the first time the window opens

  const SHARE_TEXT = "I'm using YoraBora to plan study time and find study groups for my classes. Try it:";

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "install-dialog share-dialog";
    dialog.setAttribute("aria-labelledby", "share-title");
    dialog.innerHTML = `
      <button type="button" class="install-close" aria-label="Close">×</button>
      <h2 id="share-title">Share YoraBora</h2>
      <p class="share-lead">Have a friend scan this with their phone camera.</p>
      <div class="share-qr" aria-busy="true"><span class="share-qr-loading">Making the code…</span></div>
      <p class="share-address"></p>
      <div class="share-actions">
        <button type="button" class="share-native" hidden>Share…</button>
        <button type="button" class="share-copy">Copy link</button>
      </div>
      <a class="share-save" download="yorabora-qr.svg" hidden>Save QR code</a>
      <p class="share-status" role="status" aria-live="polite"></p>`;
    dialog.querySelector(".install-close").addEventListener("click", () => dialog.close());
    // Click outside the window closes it
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector(".share-copy").addEventListener("click", copyLink);
    dialog.querySelector(".share-native").addEventListener("click", shareNative);
    document.body.appendChild(dialog);
  }

  const say = (text) => { dialog.querySelector(".share-status").textContent = text; };
  const link = () => (info && info.url) || location.origin + "/";

  async function load() {
    if (info) return show();
    try {
      const res = await fetch("/share.json");
      if (!res.ok) throw new Error("status " + res.status);
      info = await res.json();
    } catch {
      info = null; // offline or the server hiccuped: the link still works, just no picture
    }
    show();
  }

  function show() {
    const box = dialog.querySelector(".share-qr");
    box.removeAttribute("aria-busy");
    dialog.querySelector(".share-address").textContent = link().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const save = dialog.querySelector(".share-save");
    if (info && info.svg) {
      box.innerHTML = info.svg; // our own server's SVG, not anything a user typed
      const svg = box.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "QR code for " + link());
      }
      save.href = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(info.svg);
      save.hidden = false;
    } else {
      box.innerHTML = '<span class="share-qr-loading">Couldn\'t make the code. Copy the link instead.</span>';
      save.hidden = true;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link());
      say("Link copied. Paste it in a text or group chat.");
    } catch {
      // Older browsers or no permission: select the address so they can copy it themselves
      const address = dialog.querySelector(".share-address");
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      say("Press Ctrl+C (or ⌘C) to copy the highlighted link.");
    }
  }

  async function shareNative() {
    try {
      await navigator.share({ title: "YoraBora", text: SHARE_TEXT, url: link() });
      say("Thanks for sharing!");
    } catch (error) {
      if (error && error.name === "AbortError") return; // they closed the share sheet
      copyLink();
    }
  }

  function open() {
    if (!dialog) buildDialog();
    say("");
    dialog.querySelector(".share-native").hidden = !navigator.share;
    dialog.showModal();
    load();
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest && event.target.closest("[data-share-app]");
    if (!trigger) return;
    event.preventDefault();
    open();
  });

  window.studyShare = { open };
})();
