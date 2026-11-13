// StudySync - show / hide password (runs in the browser).
//
// Adds an eye button inside every password box on the page. Clicking it shows what you typed;
// clicking again hides it. Include this on any page with a password box (styles: .pw-wrap and
// .pw-toggle in style.css). For a box that isn't a password, name it: data-pw-name="token".

(function () {
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function addToggle(input) {
    if (input.dataset.pwToggle) return; // already has one
    input.dataset.pwToggle = "1";

    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const button = document.createElement("button");
    button.type = "button"; // never submits the form
    button.className = "pw-toggle";
    wrap.appendChild(button);

    const what = input.dataset.pwName || "password"; // e.g. data-pw-name="token" for the Canvas token
    function render() {
      const shown = input.type === "text";
      const label = (shown ? "Hide " : "Show ") + what;
      button.innerHTML = shown ? EYE_OFF : EYE;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(shown));
      button.title = label;
    }

    button.addEventListener("click", (event) => {
      event.preventDefault(); // inside a <label>, don't also focus/click the input twice
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.type = input.type === "password" ? "text" : "password";
      render();
      // Keep typing where you were
      input.focus();
      try { input.setSelectionRange(start, end); } catch { /* some browsers don't allow it */ }
    });

    // Hide it again before the form is sent, so the browser's password manager still sees a password
    if (input.form) input.form.addEventListener("submit", () => { input.type = "password"; render(); });

    render();
  }

  document.querySelectorAll('input[type="password"]').forEach(addToggle);
})();
