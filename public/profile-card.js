// YoraBora - a classmate's profile card (runs in the browser). Opens when you click a member
// on the group page. Shows their photo, name, and whatever they chose to share with their study
// groups: major, year and classes (lib/profiles.js, GET /api/members/<profileId>).
// Classmates' cards have "Report photo", which goes to the YoraBora team.
//
// window.studyProfile.open(profileId, fallback): fallback is the member from the group list
// ({ name, photoUrl, isYou }), shown right away while the card loads.
// Needs public/members.js (the circles) loaded first.

(function () {
  const YEARS = { freshman: "Freshman", sophomore: "Sophomore", junior: "Junior", senior: "Senior", grad: "Grad student" };
  let dialog = null;
  let current = null; // the profileId on screen

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "install-dialog profile-dialog";
    dialog.setAttribute("aria-labelledby", "profile-name");
    dialog.innerHTML = `
      <button type="button" class="install-close" aria-label="Close">×</button>
      <div class="profile-face"></div>
      <h2 id="profile-name"></h2>
      <p class="profile-sub"></p>
      <div class="profile-classes" hidden>
        <h3>Classes</h3>
        <ul></ul>
      </div>
      <p class="profile-empty" hidden></p>
      <div class="profile-actions"></div>
      <p class="profile-status" role="status" aria-live="polite"></p>`;
    dialog.querySelector(".install-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }

  function render(card) {
    const members = window.studyMembers;
    const faceBox = dialog.querySelector(".profile-face");
    faceBox.innerHTML = "";
    faceBox.appendChild(members.face({ name: card.name, photoUrl: card.photoUrl }, "large"));
    dialog.querySelector("#profile-name").textContent = card.name + (card.isYou ? " (you)" : "");

    const sub = [card.major, YEARS[card.year]].filter(Boolean).join(" · ");
    dialog.querySelector(".profile-sub").textContent = sub;
    dialog.querySelector(".profile-sub").hidden = !sub;

    const classes = Array.isArray(card.classes) ? card.classes : [];
    const box = dialog.querySelector(".profile-classes");
    const list = box.querySelector("ul");
    list.innerHTML = "";
    for (const name of classes) list.appendChild(el("li", "", name));
    box.hidden = !classes.length;

    const loading = card.loading;
    const nothing = !loading && !sub && !classes.length;
    const empty = dialog.querySelector(".profile-empty");
    empty.textContent = card.isYou ? "You haven't shared anything with your study groups yet." : "They haven't shared anything else yet.";
    empty.hidden = !nothing;

    const actions = dialog.querySelector(".profile-actions");
    actions.innerHTML = "";
    if (loading) return;
    if (card.isYou) {
      const edit = el("a", "profile-edit", "Edit your profile");
      edit.href = "/profile";
      actions.appendChild(edit);
    } else if (card.photoUrl) {
      const report = el("button", "profile-report", "Report photo");
      report.type = "button";
      report.addEventListener("click", () => showReport(card));
      actions.appendChild(report);
    }
  }

  // "Report photo": an optional reason, then it goes to the team
  function showReport(card) {
    const actions = dialog.querySelector(".profile-actions");
    actions.innerHTML = "";
    const label = el("label", "profile-report-form");
    label.append(el("span", "", "What's wrong with it? (optional)"));
    const reason = el("textarea");
    reason.maxLength = 500;
    reason.rows = 2;
    label.append(reason);
    const send = el("button", "profile-report-send", "Send report");
    send.type = "button";
    send.addEventListener("click", async () => {
      send.disabled = true;
      const status = dialog.querySelector(".profile-status");
      try {
        const res = await fetch(`/api/members/${card.profileId}/report`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't send that. Try again.");
        actions.innerHTML = "";
        status.textContent = "Thanks. The YoraBora team will take a look.";
      } catch (error) {
        status.textContent = error.message;
        send.disabled = false;
      }
    });
    actions.append(label, send);
    reason.focus();
  }

  async function open(profileId, fallback) {
    if (!profileId) return;
    if (!dialog) build();
    current = profileId;
    dialog.querySelector(".profile-status").textContent = "";
    render({ ...(fallback || { name: "" }), loading: true });
    if (!dialog.open) dialog.showModal();
    try {
      const res = await fetch("/api/members/" + profileId);
      const card = await res.json().catch(() => ({}));
      if (current !== profileId) return; // another card was opened meanwhile
      if (!res.ok) throw new Error(card.error || "Couldn't load their profile.");
      render(card);
    } catch (error) {
      if (current !== profileId) return;
      render({ ...(fallback || { name: "" }) });
      dialog.querySelector(".profile-empty").hidden = true;
      dialog.querySelector(".profile-status").textContent = error.message;
    }
  }

  window.studyProfile = { open };
})();
