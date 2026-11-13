// StudySync - lets the site be installed as an app ("Add to Home Screen"): registers the
// service worker (public/sw.js, served at /sw.js). Runs on every page.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // not installable here (e.g. an old browser or private window): the site works the same
    });
  });
}
