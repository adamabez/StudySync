// StudySync - account settings page (runs in the browser): theme, change email,
// change password, delete account. Every account change asks for the current password.

const $ = (id) => document.getElementById(id);

function showMessage(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = "form-message " + (ok ? "ok" : "error");
  el.hidden = !text;
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) {
    window.location.href = "/";
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

// Run a form's request with its button disabled
function handle(formId, messageId, run) {
  const form = $(formId);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(messageId, "", true);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await run(form);
    } catch (error) {
      showMessage(messageId, error.message, false);
    } finally {
      button.disabled = false;
    }
  });
}

// ---------- Appearance ----------
function showThemeChoice() {
  const current = window.studysyncTheme ? window.studysyncTheme.get() : "system";
  for (const radio of document.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === current;
}
for (const radio of document.querySelectorAll('input[name="theme"]')) {
  radio.addEventListener("change", () => window.studysyncTheme && window.studysyncTheme.set(radio.value));
}
showThemeChoice();
document.addEventListener("studysync-theme", showThemeChoice); // the sun / moon button was used

// ---------- Email ----------
handle("email-form", "email-message", async (form) => {
  const data = await post("/api/account/email", { email: $("new-email").value, password: $("email-password").value });
  if (!data) return;
  form.reset();
  if (data.pending) {
    showMessage("email-message", "Check your new inbox for a confirmation link. Your email changes once you click it.", true);
  } else {
    $("current-email").textContent = data.email;
    showMessage("email-message", "Done! You now log in with " + data.email + ".", true);
  }
});

// ---------- Password ----------
handle("password-form", "password-message", async (form) => {
  const data = await post("/api/account/password", { currentPassword: $("current-password").value, newPassword: $("new-password").value });
  if (!data) return;
  form.reset();
  showMessage("password-message", "Password changed.", true);
});

// ---------- Delete account ----------
handle("delete-form", "delete-message", async () => {
  if ($("delete-confirm").value.trim() !== "DELETE") throw new Error("Type DELETE (in capitals) to confirm.");
  if (!confirm("Delete your StudySync account for good? This can't be undone.")) return;
  const data = await post("/api/account/delete", { password: $("delete-password").value, confirm: "DELETE" });
  if (data) window.location.href = "/?deleted=1";
});

// ---------- Who's logged in ----------
fetch("/api/me")
  .then((res) => (res.ok ? res.json() : null))
  .then((me) => {
    if (!me || !me.email) return;
    $("current-email").textContent = me.email;
    $("account-email-line").textContent = "Account settings for " + me.email;
  })
  .catch(() => {});
