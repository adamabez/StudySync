// YoraBora - your profile page (runs in the browser): your name, photo, major, year and classes,
// and which of them your study groups see (lib/profiles.js). Account things (email, password,
// theme, deleting the account) are on the account settings page (public/account.js).

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
    window.location.href = "/login";
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

// ---------- Name ----------
handle("name-form", "name-message", async () => {
  const data = await post("/api/profile", { displayName: $("display-name").value });
  if (!data) return;
  $("display-name").value = data.displayName;
  showMessage("name-message", "Saved. Your study groups now see you as " + data.displayName + ".", true);
});

// ---------- Profile (lib/profiles.js) ----------
// Photo, major and year. Your photo always shows to your study groups; major, year and classes
// each have a "Show to my study groups" switch.
// Switches save as soon as they're flipped; major and year save with the button. A new photo
// is shrunk to a 256 × 256 square here in the browser, then uploaded.
const PHOTO_SIZE = 256;
let myProfile = null;

async function profileRequest(method, url, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function showProfile(profile) {
  myProfile = profile;
  $("profile-off").hidden = profile.setUp !== false;
  $("profile-editor").hidden = profile.setUp === false;
  if (profile.setUp === false) return;

  $("profile-major").value = profile.major || "";
  $("profile-year").value = profile.year || "";
  for (const box of document.querySelectorAll("[data-share]")) box.checked = Boolean(profile.share[box.dataset.share]);

  const preview = $("profile-photo-preview");
  preview.innerHTML = "";
  const name = $("display-name").value || "?";
  if (window.studyMembers) preview.appendChild(window.studyMembers.face({ name, photoUrl: profile.photoUrl }, "large"));
  $("photo-pick-text").textContent = profile.photoUrl ? "Change photo" : "Add a photo";
  $("photo-remove").hidden = !profile.photoUrl;

  const chips = $("profile-classes");
  chips.innerHTML = "";
  for (const className of profile.classes) {
    const li = document.createElement("li");
    li.textContent = className;
    chips.appendChild(li);
  }
  if (!profile.classes.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No classes on your schedule yet";
    chips.appendChild(li);
  }
}

// Major and year
handle("profile-form", "profile-message", async () => {
  const data = await profileRequest("POST", "/api/profile/card", { major: $("profile-major").value, year: $("profile-year").value });
  if (!data) return;
  showProfile(data);
  showMessage("profile-message", "Saved.", true);
});

// The "Show to my study groups" switches save right away
for (const box of document.querySelectorAll("[data-share]")) {
  box.addEventListener("change", async () => {
    showMessage("profile-message", "", true);
    try {
      const data = await profileRequest("POST", "/api/profile/card", { share: { [box.dataset.share]: box.checked } });
      if (!data) return;
      showProfile(data);
      showMessage("profile-message", box.checked ? "Your study groups can see that now." : "Hidden from your study groups.", true);
    } catch (error) {
      box.checked = !box.checked;
      showMessage("profile-message", error.message, false);
    }
  });
}

// Any picture → a centered 256 × 256 square, as WebP (or JPEG where the browser can't make WebP)
async function squarePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file isn't a picture this browser can open. Try a JPG or PNG."));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent PNGs get a white background
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$("photo-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = ""; // picking the same file again still counts
  if (!file) return;
  showMessage("profile-message", "Uploading…", true);
  try {
    const image = await squarePhoto(file);
    const data = await profileRequest("POST", "/api/profile/photo", { image });
    if (!data) return;
    showProfile(data);
    updateHeaderPhoto(data.photoUrl);
    showMessage("profile-message", "Photo saved. Your study groups can see it now.", true);
  } catch (error) {
    showMessage("profile-message", error.message, false);
  }
});

$("photo-remove").addEventListener("click", async () => {
  if (!confirm("Remove your photo?")) return;
  try {
    const data = await profileRequest("DELETE", "/api/profile/photo");
    if (!data) return;
    showProfile(data);
    updateHeaderPhoto(null);
    showMessage("profile-message", "Photo removed.", true);
  } catch (error) {
    showMessage("profile-message", error.message, false);
  }
});

// The account circle in the header (public/nav.js) follows the new photo
function updateHeaderPhoto(url) {
  const button = document.getElementById("account-button");
  if (!button) return;
  button.querySelectorAll(".avatar-photo").forEach((img) => img.remove());
  if (!url) return;
  const img = document.createElement("img");
  img.className = "avatar-photo";
  img.alt = "";
  img.src = url;
  img.addEventListener("error", () => img.remove());
  button.appendChild(img);
}

// ---------- Who's logged in ----------
fetch("/api/me")
  .then((res) => (res.ok ? res.json() : null))
  .then((me) => {
    if (!me || !me.email) return;
    $("display-name").value = me.name || "";
    if (!me.name && location.hash === "#name") $("display-name").focus();
  })
  .catch(() => {})
  .then(() => fetch("/api/profile/card"))
  .then((res) => (res && res.ok ? res.json() : { setUp: false }))
  .then(showProfile)
  .catch(() => showProfile({ setUp: false }));
