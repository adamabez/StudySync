// StudySync - study group members in the browser: initials in colored circles, and who joined
// or left since you last opened the group. Used by the study plan's group cards (landing.js)
// and the group page (group.js). Load before them.
//
// Member changes: the server only knows who's in a group now, so each browser remembers the
// members it last saw on the group's page (localStorage, per group) and compares. The study plan
// card shows "1 new member" until you open the group; opening its page counts as seeing it.

(function () {
  const KEY = (groupId) => "studysync-group-members:" + groupId;

  // A steady color from a name (the same class or person always gets the same color)
  function hueFor(text) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return (h + 200) % 360;
  }

  // "Maya R." → "MR", "Demo student" → "DS"
  function initials(name) {
    const words = String(name || "?").trim().split(" ").filter(Boolean);
    return ((words[0] || "?")[0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  }

  // One member's circle (yours gets an outline in the group's color)
  function face(member, extraClass) {
    const el = document.createElement("span");
    el.className = "group-face" + (member.isYou ? " you" : "") + (extraClass ? " " + extraClass : "");
    el.style.setProperty("--f-hue", hueFor(member.name));
    el.textContent = initials(member.name);
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  // Overlapping circles for the first `max` members, then "+N"
  function faces(members, max = 4) {
    const box = document.createElement("span");
    box.className = "group-faces";
    box.setAttribute("aria-hidden", "true");
    for (const member of members.slice(0, max)) box.appendChild(face(member));
    if (members.length > max) {
      const more = document.createElement("span");
      more.className = "group-face more";
      more.textContent = "+" + (members.length - max);
      box.appendChild(more);
    }
    return box;
  }

  const others = (members) => members.filter((m) => !m.isYou).map((m) => m.name);

  function read(groupId) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(groupId)) || "null");
      return Array.isArray(saved) ? saved : null;
    } catch {
      return null; // storage blocked (private browsing): no change notes, nothing breaks
    }
  }

  // Who joined or left since the members were last remembered here: { joined, left }.
  // Nothing remembered yet (first visit, or another device) → no changes.
  function changes(groupId, members) {
    const before = read(groupId);
    if (!before) return { joined: [], left: [] };
    const now = others(members);
    return { joined: now.filter((n) => !before.includes(n)), left: before.filter((n) => !now.includes(n)) };
  }

  // The group's page was opened: these are the members you've seen
  function remember(groupId, members) {
    try {
      localStorage.setItem(KEY(groupId), JSON.stringify(others(members)));
    } catch {
      // can't save: changes just won't be noted
    }
  }

  // ["Maya", "Jordan"] → "Maya and Jordan"
  const listNames = (names) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);

  window.studyMembers = { hueFor, initials, face, faces, changes, remember, listNames };
})();
