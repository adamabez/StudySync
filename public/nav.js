// StudySync - the header on every logged-in page (runs in the browser).
//
// Logo (→ the dashboard, where logging in lands) · Dashboard | Study plan | Notes | Calendar tabs · light/dark switch (theme.js puts it next to the
// account circle) · account circle. The circle opens a menu: who's logged in, Edit schedule,
// Account settings, Get the app (early), Log out. In the demo it offers sign-up and "Exit demo" instead.
//
// Phones get the same tabs, on their own row under the logo (dashboard.css, 600px and under).
//
// Each page has <nav id="app-nav" data-page="dashboard|plan|..."></nav> where the header
// goes; data-page picks which tab is highlighted (none for other pages). Load this script
// right after that element, before theme.js adds the switch.
//
// window.studyNav.me is a promise of { email, name, demo } (or null), so pages can greet
// the student without asking the server again.

(function () {
  const holder = document.getElementById("app-nav");
  if (!holder) return;
  const current = holder.dataset.page || "";

  const TABS = [
    { page: "dashboard", href: "/dashboard", label: "Dashboard" },
    { page: "plan", href: "/landing", label: "Study plan" },
    { page: "notes", href: "/notes", label: "Notes" },
    { page: "calendar", href: "/calendar", label: "Calendar" },
  ];

  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  };

  // ---------- Build it ----------
  holder.classList.add("app-nav");
  holder.setAttribute("aria-label", "StudySync");

  const logo = el("a", { href: "/dashboard", class: "logo-link app-logo", "aria-label": "StudySync: go to your dashboard" });
  logo.append(el("img", { src: "/public/logo.png", alt: "StudySync", class: "logo" }));

  const tabs = el("div", { class: "app-tabs" });
  for (const tab of TABS) {
    const link = el("a", { href: tab.href, class: "app-tab" }, tab.label);
    if (tab.page === current) link.setAttribute("aria-current", "page");
    tabs.append(link);
  }

  const account = el("div", { class: "account", id: "account" });
  const button = el("button", { type: "button", class: "avatar", id: "account-button", "aria-label": "Account", "aria-expanded": "false", "aria-controls": "account-menu" });
  const initial = el("span", { "aria-hidden": "true" }, "?");
  button.append(initial);

  const menu = el("div", { class: "account-menu", id: "account-menu" });
  const card = el("div", { class: "account-card" });
  const label = el("span", { class: "account-label" }, "Logged in as");
  const name = el("span", { class: "account-name", hidden: "" });
  const email = el("span", { class: "account-email" }, "your account");
  const links = el("div", { class: "account-links" });
  const item = (href, text) => el("a", { href, class: "account-item" }, text);
  const editLink = item("/setup", "Edit schedule");
  const settingsLink = item("/account", "Account settings");
  const logoutLink = item("/logout", "Log out");
  const appLink = item("#", "Get the app (early)"); // opens the install window (public/install.js)
  appLink.setAttribute("data-install-app", "");
  links.append(editLink, settingsLink, appLink, logoutLink);
  card.append(label, name, email, links);
  menu.append(card);
  account.append(button, menu);

  holder.append(logo, tabs, account);

  // ---------- Opening and closing the menu ----------
  // Computers: hovering or tabbing to the circle opens it (CSS). Phones: tap to open; tapping
  // elsewhere or pressing Escape closes it.
  function setOpen(open) {
    account.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
  }
  button.addEventListener("click", () => {
    account.classList.remove("dismissed");
    setOpen(!account.classList.contains("open"));
  });
  document.addEventListener("click", (event) => {
    if (!account.contains(event.target)) setOpen(false);
  });
  // Escape closes it and puts focus back on the circle. "dismissed" keeps it closed until
  // you tab away or move the mouse off, so it doesn't pop right back open.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!account.contains(document.activeElement) && !account.classList.contains("open")) return;
    setOpen(false);
    account.classList.add("dismissed");
    button.focus();
  });
  account.addEventListener("focusout", (event) => {
    if (!account.contains(event.relatedTarget)) account.classList.remove("dismissed");
  });
  account.addEventListener("mouseleave", () => account.classList.remove("dismissed"));

  // ---------- Who's logged in ----------
  const me = fetch("/api/me")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);

  me.then((info) => {
    if (!info || !info.email) return;
    const who = info.name || info.email;
    initial.textContent = who[0].toUpperCase();
    button.setAttribute("aria-label", "Account: " + who);
    email.textContent = info.email;
    email.title = info.email; // the full address, in case it's cut off
    if (info.name && info.name !== info.email) {
      name.textContent = info.name;
      name.hidden = false;
    }
    if (info.demo) {
      // No account to open in the demo
      label.textContent = "Trying the demo";
      email.hidden = true;
      settingsLink.textContent = "Create a free account";
      settingsLink.href = "/signup";
      logoutLink.textContent = "Exit demo";
    }
  });

  window.studyNav = { me };
})();
