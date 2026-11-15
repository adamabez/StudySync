// StudySync - what a new password needs, as a checklist under the box (runs in the browser).
//
// Matches the password rules set in Supabase (Authentication → Sign In / Providers → Email):
// at least 6 characters, with a lowercase letter, an uppercase letter, a number and a symbol.
// If those settings change, change RULES here and the "weakchars" messages (lib/auth.js
// errorCode, signup.html, reset-password.html, routes/account.js) to match.
//
// Runs on every box with autocomplete="new-password" (sign up, reset password, account settings).
// Each rule ticks off as you type, and the form won't send until they're all met, so students
// find out here instead of from an error after submitting.

(function () {
  // Supabase's symbol list: !@#$%^&*()_+-=[]{};':"|<>?,./`~
  const SYMBOLS = /[!@#$%^&*()_+\-=[\]{};':"|<>?,./`~]/;
  const RULES = [
    { label: "At least 6 characters", test: (pw) => pw.length >= 6 },
    { label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
    { label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
    { label: "A number", test: (pw) => /[0-9]/.test(pw) },
    { label: "A symbol, like ! # or ?", test: (pw) => SYMBOLS.test(pw) },
  ];

  function addRules(input) {
    if (input.dataset.pwRules) return;
    input.dataset.pwRules = "1";

    const list = document.createElement("ul");
    list.className = "pw-rules";
    list.id = (input.id || "new-password") + "-rules";
    list.setAttribute("aria-label", "Your password needs");
    const items = RULES.map((rule) => {
      const li = document.createElement("li");
      li.textContent = rule.label;
      list.appendChild(li);
      return li;
    });
    (input.closest("label") || input).after(list);
    input.setAttribute("aria-describedby", list.id);

    function update() {
      const pw = input.value;
      const missing = [];
      RULES.forEach((rule, i) => {
        const ok = rule.test(pw);
        items[i].classList.toggle("ok", ok);
        if (!ok) missing.push(rule.label.toLowerCase());
      });
      // The browser shows this and stops the form if something's missing
      input.setCustomValidity(missing.length && pw ? "Your password still needs: " + missing.join(", ") + "." : "");
    }
    input.addEventListener("input", update);
    update();
  }

  function init() {
    document.querySelectorAll('input[autocomplete="new-password"]').forEach(addRules);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
