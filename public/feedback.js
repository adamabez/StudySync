// StudySync - the "Send feedback / report a bug" link at the bottom of the dashboard.
// Opens a small form in a popup and sends it to POST /api/feedback.

(() => {
  const dialog = document.getElementById("feedback-dialog");
  const form = document.getElementById("feedback-form");
  const kind = document.getElementById("feedback-kind");
  const message = document.getElementById("feedback-message");
  const messageLabel = document.getElementById("feedback-message-label");
  const errorText = document.getElementById("feedback-error");
  const submit = document.getElementById("feedback-submit");
  const thanks = document.getElementById("feedback-thanks");

  // Change the prompt to fit what they're sending
  const PROMPTS = {
    bug: ["What went wrong?", "What did you do, what did you expect, and what happened instead?"],
    feedback: ["Your feedback", "What's working, what's confusing, what could be better?"],
    idea: ["Your idea", "What would you like StudySync to do?"],
  };
  function updatePrompt() {
    const [label, placeholder] = PROMPTS[kind.value];
    messageLabel.textContent = label;
    message.placeholder = placeholder;
  }
  kind.addEventListener("change", updatePrompt);

  function open() {
    form.hidden = false;
    thanks.hidden = true;
    errorText.textContent = "";
    updatePrompt();
    dialog.showModal();
    message.focus();
  }

  document.getElementById("feedback-open").addEventListener("click", open);
  document.getElementById("feedback-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("feedback-done").addEventListener("click", () => dialog.close());
  // Clicking the dark area outside the popup closes it
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorText.textContent = "";
    const text = message.value.trim();
    if (!text) {
      errorText.textContent = "Write a message first.";
      return;
    }

    submit.disabled = true;
    submit.textContent = "Sending…";
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kind.value, message: text, page: location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send that. Try again.");
      message.value = "";
      form.hidden = true;
      thanks.hidden = false;
      document.getElementById("feedback-done").focus();
    } catch (error) {
      errorText.textContent = error.message || "Couldn't send that. Try again.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Send";
    }
  });
})();
