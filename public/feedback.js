// StudySync - feedback, bug reports and feature ideas, from every page (runs in the browser).
//
// Adds a "Suggest a feature" button to the bottom corner of the page and the popup form it
// opens. Anything with data-feedback-open (or id="feedback-open") opens the form too.
// Sends to POST /api/feedback, which works with or without an account (server.js).
//
// Include it on a page with:
//   <link rel="stylesheet" href="/public/feedback.css">
//   <script src="/public/feedback.js"></script>

(() => {
  const KINDS = {
    idea: {
      label: "💡 Feature idea",
      title: "What would you like StudySync to do?",
      placeholder: "e.g. Remind me the night before an assignment is due",
      starters: ["I wish StudySync could… ", "It would be easier if… ", "Can you connect it to… "],
    },
    bug: {
      label: "🐞 Something broke",
      title: "What went wrong?",
      placeholder: "What did you do, what did you expect, and what happened instead?",
      starters: [],
    },
    feedback: {
      label: "💬 General feedback",
      title: "What do you think?",
      placeholder: "What's working, what's confusing, what could be better?",
      starters: ["I really like… ", "I got confused when… "],
    },
  };

  let who = null; // { loggedIn, demo } once /api/me has answered

  // ---------- Build the button and the popup ----------

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "fb-fab";
  fab.setAttribute("aria-haspopup", "dialog");
  fab.innerHTML = '<span class="fb-fab-icon" aria-hidden="true">💡</span><span class="fb-fab-text">Suggest a feature</span><span class="fb-fab-beta">Beta</span>';
  fab.title = "StudySync is still in development. Share an idea, report a bug, or tell us what you think.";

  const dialog = document.createElement("dialog");
  dialog.className = "fb-dialog";
  dialog.setAttribute("aria-labelledby", "fb-title");
  dialog.innerHTML = `
    <form class="fb-form" novalidate>
      <div class="fb-head">
        <span class="fb-badge">Still in development</span>
        <button type="button" class="fb-close" aria-label="Close">×</button>
      </div>
      <h2 id="fb-title">Help shape StudySync</h2>
      <p class="fb-intro">StudySync is being built right now by a small student team, and your ideas decide what we build next. Big or small, we read every one.</p>

      <fieldset class="fb-kinds">
        <legend class="fb-sr">What kind of message?</legend>
        ${Object.entries(KINDS).map(([key, k], i) => `
          <label class="fb-kind"><input type="radio" name="fb-kind" value="${key}"${i === 0 ? " checked" : ""}><span>${k.label}</span></label>`).join("")}
      </fieldset>

      <label class="fb-field"><span class="fb-label" id="fb-message-label"></span>
        <textarea class="fb-message" rows="5" maxlength="5000" required></textarea>
      </label>
      <div class="fb-starters" aria-label="Ideas to get you started"></div>

      <label class="fb-field fb-email-field" hidden><span class="fb-label">Email <span class="fb-optional">(optional, if you'd like a reply)</span></span>
        <input class="fb-email" type="email" autocomplete="email" maxlength="200" placeholder="you@example.com">
      </label>

      <p class="fb-note"></p>
      <p class="fb-error error" role="alert"></p>
      <div class="fb-actions">
        <button type="button" class="fb-cancel">Cancel</button>
        <button type="submit" class="fb-submit">Send</button>
      </div>
    </form>
    <div class="fb-thanks" hidden>
      <div class="fb-thanks-icon" aria-hidden="true">🙌</div>
      <h2>Thank you!</h2>
      <p>The StudySync team reads every message. Ideas like yours are how we decide what to build next.</p>
      <div class="fb-actions fb-thanks-actions">
        <button type="button" class="fb-another">Send another</button>
        <button type="button" class="fb-done">Done</button>
      </div>
    </div>`;

  document.body.append(fab, dialog);

  const $ = (selector) => dialog.querySelector(selector);
  const form = $(".fb-form");
  const message = $(".fb-message");
  const email = $(".fb-email");
  const errorText = $(".fb-error");
  const submit = $(".fb-submit");
  const thanks = $(".fb-thanks");
  const starters = $(".fb-starters");

  const currentKind = () => form.querySelector('input[name="fb-kind"]:checked').value;

  // Change the prompt and the "get started" chips to fit what they're sending
  function updateKind() {
    const kind = KINDS[currentKind()];
    $("#fb-message-label").textContent = kind.title;
    message.placeholder = kind.placeholder;
    starters.replaceChildren(...kind.starters.map((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "fb-starter";
      chip.textContent = text.trim();
      chip.addEventListener("click", () => {
        if (!message.value.trim()) message.value = text;
        else message.value = message.value.replace(/\s*$/, "\n") + text;
        message.focus();
        message.setSelectionRange(message.value.length, message.value.length);
      });
      return chip;
    }));
    starters.hidden = kind.starters.length === 0;
  }
  form.addEventListener("change", (event) => {
    if (event.target.name === "fb-kind") updateKind();
  });

  // Who's sending it decides the small print and whether to ask for an email
  async function loadWho() {
    if (who) return who;
    try {
      const res = await fetch("/api/me");
      const me = res.ok ? await res.json() : null;
      who = { loggedIn: Boolean(me && me.email && !me.demo), demo: Boolean(me && me.demo) };
    } catch {
      who = { loggedIn: false, demo: false };
    }
    $(".fb-email-field").hidden = who.loggedIn;
    $(".fb-note").textContent = who.loggedIn
      ? "We'll include your email and browser so we can follow up."
      : "We'll include your browser and the page you're on, nothing else.";
    return who;
  }

  // ---------- Open / close ----------

  function open(kind) {
    form.hidden = false;
    thanks.hidden = true;
    errorText.textContent = "";
    if (kind && KINDS[kind]) form.querySelector(`input[value="${kind}"]`).checked = true;
    updateKind();
    loadWho();
    dialog.showModal();
    message.focus();
  }

  fab.addEventListener("click", () => open());
  document.querySelectorAll("[data-feedback-open], #feedback-open").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      open(el.dataset.feedbackOpen);
    });
  });
  $(".fb-close").addEventListener("click", () => dialog.close());
  $(".fb-cancel").addEventListener("click", () => dialog.close());
  $(".fb-done").addEventListener("click", () => dialog.close());
  $(".fb-another").addEventListener("click", () => open(currentKind()));
  // Clicking the dark area outside the popup closes it
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  // A link ending in #feedback (e.g. studysync.../#feedback on a poster) opens the form right away
  if (location.hash === "#feedback") open("idea");

  // ---------- Send ----------

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorText.textContent = "";
    const text = message.value.trim();
    if (!text || KINDS[currentKind()].starters.some((s) => s.trim() === text)) {
      errorText.textContent = "Write a little more first.";
      message.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "Sending…";
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: currentKind(), message: text, page: location.pathname, email: email.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send that. Try again.");
      message.value = "";
      form.hidden = true;
      thanks.hidden = false;
      $(".fb-done").focus();
    } catch (error) {
      errorText.textContent = error.message || "Couldn't send that. Try again.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Send";
    }
  });
})();
