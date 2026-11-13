// StudySync - the header on every logged-in page (runs in the browser).
//
// Logo (→ the dashboard, where logging in lands) · Dashboard | Study plan | Calendar tabs · light/dark switch (theme.js puts it next to the
// account circle) · account circle. The circle opens a menu: who's logged in, Edit schedule,
// Account settings, Get the app (early), Log out. In the demo it offers sign-up and "Exit demo" instead.
//
// Phones get a tab bar fixed to the bottom of the screen instead of the top tabs: Dashboard,
// Study plan, Calendar, Schedule, Account, always one tap away (dashboard.css shows it at 600px and under).
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

  // ---------- Phones: tab bar at the bottom ----------
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    plan: '<path d="M12 3l2.4 6.1L21 12l-6.6 2.9L12 21l-2.4-6.1L3 12l6.6-2.9z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="16" cy="15" r="1"/>',
    schedule: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M14.5 13.5l2 2-4 4h-2v-2z"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const BAR = [
    ...TABS,
    { page: "schedule", href: "/setup", label: "Schedule" },
    { page: "account", href: "/account", label: "Account" },
  ];
  const bar = el("nav", { class: "app-tabbar", "aria-label": "Pages" });
  for (const tab of BAR) {
    const link = el("a", { href: tab.href, class: "app-tabbar-item", "data-page": tab.page });
    link.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[tab.page] + "</svg>";
    link.append(el("span", {}, tab.label));
    if (tab.page === current) link.setAttribute("aria-current", "page");
    bar.append(link);
  }
  document.body.append(bar);
  document.body.classList.add("has-tabbar");

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
      // No account to open in the demo: the bar's Account becomes sign-up
      const barAccount = bar.querySelector('[data-page="account"]');
      barAccount.href = "/signup";
      barAccount.querySelector("span").textContent = "Sign up";
      label.textContent = "Trying the demo";
      email.hidden = true;
      settingsLink.textContent = "Create a free account";
      settingsLink.href = "/signup";
      logoutLink.textContent = "Exit demo";
    }
  });

  window.studyNav = { me };
})();
