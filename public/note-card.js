// StudySync - one shared group note as a card (runs in the browser). Used by the group page
// (group.js) and the Notes page (notes.js). Load after members.js.
//
// The card: the author's initials, their name and how long ago, the title and the note (long
// ones fold, with Show more). Yours can be deleted. The Notes page also shows which group it's in.

(function () {
  // "Just now", "5 min ago", "3 hours ago", "Yesterday", "Nov 12"
  function timeAgo(iso) {
    const then = new Date(iso);
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (then.toDateString() === yesterday.toDateString()) return "Yesterday";
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const fullDate = (iso) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // options: { groupId, onRemoved(), group: { id, course, label, hue } (Notes page: which group) }
  function card(note, options) {
    const members = window.studyMembers;
    const el = document.createElement("article");
    el.className = "note-card";
    el.style.setProperty("--n-hue", members.hueFor(note.author || "you"));

    const head = document.createElement("div");
    head.className = "note-head";
    head.appendChild(members.face({ name: note.author || "You", isYou: note.isYours }, "note-face"));
    const who = document.createElement("div");
    who.className = "note-who";
    const name = document.createElement("strong");
    name.textContent = note.isYours ? "You" : note.author;
    const when = document.createElement("span");
    when.className = "note-when";
    when.textContent = timeAgo(note.createdAt);
    when.title = fullDate(note.createdAt);
    who.append(name, when);
    head.appendChild(who);

    if (note.isYours) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "note-delete";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete " + note.title);
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this note for everyone in the group?")) return;
        const res = await fetch("/api/groups/" + options.groupId + "/notes/" + note.id, { method: "DELETE" });
        if (res.ok) el.remove();
        if (options.onRemoved) options.onRemoved();
      });
      head.appendChild(remove);
    }
    el.appendChild(head);

    // Notes page: which group it's from, linking to the group's page
    if (options.group) {
      const tag = document.createElement("a");
      tag.className = "note-group";
      tag.href = "/group?id=" + encodeURIComponent(options.group.id);
      tag.style.setProperty("--g-hue", options.group.hue);
      tag.textContent = options.group.course + (options.group.label ? " · " + options.group.label : "");
      el.appendChild(tag);
    }

    const title = document.createElement("h3");
    title.className = "note-title";
    title.textContent = note.title;
    el.appendChild(title);

    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = note.body;
    el.appendChild(body);

    // Long notes fold to a few lines, with Show more / Show less
    if (note.body.length > 360 || note.body.split("\n").length > 8) {
      body.classList.add("folded");
      const more = document.createElement("button");
      more.type = "button";
      more.className = "note-more";
      more.textContent = "Show more";
      more.setAttribute("aria-expanded", "false");
      more.addEventListener("click", () => {
        const open = body.classList.toggle("folded") === false;
        more.textContent = open ? "Show less" : "Show more";
        more.setAttribute("aria-expanded", String(open));
      });
      el.appendChild(more);
    }
    return el;
  }

  window.studyNotes = { timeAgo, card };
})();
