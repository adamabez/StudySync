// StudySync - light / dark mode (runs in the browser, in each page's <head> so there's no
// flash of the wrong colors). The choice is made on the account page and saved on this
// device: "system" (match the device's setting, the default), "light" or "dark".
// Sets <html data-theme="dark"> for public/dark.css to style.

(function () {
  const KEY = "studysync-theme";
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function get() {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return "system"; // storage blocked: follow the device
    }
  }

  function apply() {
    const choice = get();
    const dark = choice === "dark" || (choice === "system" && media && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    swapLogos();
    updateToggles();
  }

  // The logo has a dark-mode version (light "Study", brighter blue). dark.css swaps it with
  // CSS; this does the same for browsers that don't support that.
  function swapLogos() {
    const dark = document.documentElement.dataset.theme === "dark";
    for (const img of document.querySelectorAll("img.logo")) {
      const want = dark ? "/public/logo-dark.png" : "/public/logo.png";
      if (img.getAttribute("src") !== want) img.setAttribute("src", want);
    }
  }
  document.addEventListener("DOMContentLoaded", swapLogos);

  function set(choice) {
    try {
      if (choice === "light" || choice === "dark") localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch {
      // can't save: it still changes for this visit
    }
    apply();
  }

  // ---------- The sun / moon toggle ----------
  // Goes in the page's header: next to the account circle on the dashboard, at the end of the
  // header links elsewhere, or in the top-right corner on pages without a header (login...).
  const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function updateToggles() {
    const dark = document.documentElement.dataset.theme === "dark";
    for (const button of document.querySelectorAll(".theme-toggle")) {
      button.innerHTML = dark ? SUN : MOON;
      const label = dark ? "Switch to light mode" : "Switch to dark mode";
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  }

  function addToggle() {
    if (document.querySelector(".theme-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.addEventListener("click", () => {
      set(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      document.dispatchEvent(new CustomEvent("studysync-theme")); // the account page's radio buttons follow
    });

    const account = document.getElementById("account");           // dashboard
    const links = document.querySelector(".head-links");          // study plan, account, group pages
    const pageHead = document.querySelector(".page-head");        // setup page
    if (account && account.parentElement) {
      const actions = document.createElement("div");
      actions.className = "header-actions";
      account.parentElement.insertBefore(actions, account);
      actions.append(button, account);
    } else if (links) {
      links.appendChild(button);
    } else if (pageHead) {
      pageHead.appendChild(button);
    } else {
      button.classList.add("floating");
      document.body.appendChild(button);
    }
    updateToggles();
  }

  apply();
  if (media && media.addEventListener) media.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", addToggle);
  window.studysyncTheme = { get, set };
})();
