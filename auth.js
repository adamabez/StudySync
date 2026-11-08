// StudySync - login with Supabase Auth, and who's logged in.
//
// Needs two lines in .env (see .env.example):
//   SUPABASE_URL=https://<your-project>.supabase.co
//   SUPABASE_KEY=<your project's publishable / anon key>
//
// How it works:
//   1. The user logs in with email + password. Supabase checks it and gives back
//      an access token (proves who they are, lasts ~1 hour) and a refresh token
//      (used to get a new access token when the old one runs out).
//   2. We keep both in HttpOnly cookies, so the browser's JavaScript can't read them.
//   3. On each request, loadUser() checks the access token with Supabase. If it has
//      run out, it uses the refresh token to get a new one and updates the cookies.
//   Sessions live in Supabase, so restarting our server doesn't log anyone out.

const { createClient, isAuthRetryableFetchError } = require("@supabase/supabase-js");

const ACCESS_COOKIE = "sb_access";
const REFRESH_COOKIE = "sb_refresh";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, then the user logs in again

// False if the keys are missing, or still the placeholders copied from .env.example
function isConfigured() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_KEY || "";
  if (!url || !key) return false;
  return !url.includes("your-project") && !key.startsWith("your-");
}

// A fresh Supabase client. We make a new one for each job instead of sharing one,
// so one user's login can never leak into another user's request.
function newClient(accessToken) {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  if (accessToken) options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, options);
}

// ---------- Cookies ----------

function readCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Online (PUBLIC_URL is https) the cookies are also marked Secure: only ever sent over https
function cookie(name, value, maxAge) {
  const secure = /^https:\/\//i.test((process.env.PUBLIC_URL || "").trim()) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

// Cookies that store a Supabase session in the browser
function sessionCookies(session) {
  return [
    cookie(ACCESS_COOKIE, session.access_token, COOKIE_MAX_AGE),
    cookie(REFRESH_COOKIE, session.refresh_token, COOKIE_MAX_AGE),
  ];
}

// Cookies that clear the session from the browser
function clearedCookies() {
  return [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)];
}

// ---------- Turning Supabase errors into messages for the login page ----------

// Short codes go in the URL (/?error=invalid), and the page shows the matching message
function errorCode(error) {
  const code = error?.code || "";
  const message = (error?.message || "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login")) return "invalid";
  if (code === "email_not_confirmed" || message.includes("not confirmed")) return "unconfirmed";
  if (code === "user_already_exists" || message.includes("already registered")) return "exists";
  if (code === "weak_password" || message.includes("password should")) return "weak";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "rate";
  if (code === "email_address_invalid" || message.includes("invalid format")) return "email";
  if (code === "unreachable" || isAuthRetryableFetchError(error)) return "unreachable";
  console.error("Supabase auth error:", error);
  return "unknown";
}

// ---------- Logging in, signing up, logging out ----------

// Runs a Supabase auth call, turning a crash (bad SUPABASE_URL, no internet) into an error code
async function safely(call) {
  try {
    return await call();
  } catch (error) {
    console.error("Supabase auth call failed:", error.message);
    return { data: {}, error: { code: "unreachable" } };
  }
}

// Returns { cookies } on success, or { error: "<code>" }
async function logIn(email, password) {
  if (!isConfigured()) return { error: "config" };
  const { data, error } = await safely(() => newClient().auth.signInWithPassword({ email, password }));
  if (error) return { error: errorCode(error) };
  return { cookies: sessionCookies(data.session) };
}

// Returns { cookies } if the user can start right away,
// { confirmEmail: true } if Supabase sent a confirmation email first,
// or { error: "<code>" }
async function signUp(email, password) {
  if (!isConfigured()) return { error: "config" };
  const { data, error } = await safely(() => newClient().auth.signUp({ email, password }));
  if (error) return { error: errorCode(error) };
  // With "Confirm email" on, Supabase also returns no session for an email that's
  // already registered, so the response can't be used to find out who has an account.
  if (!data.session) return { confirmEmail: true };
  return { cookies: sessionCookies(data.session) };
}

// ---------- Forgot password ----------
//
// 1. sendPasswordReset() asks Supabase to email a reset link.
// 2. The link brings the user back to /reset-password with a short-lived login
//    in the URL (after the #, so only the browser sees it).
// 3. The page sends that login + the new password to resetPassword(), which
//    changes the password and logs the user in.

// Returns {} when the email was sent (or the address has no account; we don't
// say which, so nobody can use this to find out who has an account), or { error }.
async function sendPasswordReset(email, redirectTo) {
  if (!isConfigured()) return { error: "config" };
  const { error } = await safely(() => newClient().auth.resetPasswordForEmail(email, { redirectTo }));
  if (error) {
    const code = errorCode(error);
    if (code === "rate" || code === "email" || code === "unreachable") return { error: code };
  }
  return {};
}

// Returns { cookies } on success, or { error: "<code>" }
async function resetPassword(accessToken, refreshToken, password) {
  if (!isConfigured()) return { error: "config" };
  const client = newClient();
  const session = await safely(() => client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
  if (session.error || !session.data.session) return { error: "expired" };

  const { error } = await safely(() => client.auth.updateUser({ password }));
  if (error) return { error: error.code === "same_password" ? "same" : errorCode(error) };

  const { data } = await client.auth.getSession();
  return { cookies: sessionCookies(data.session) };
}

// ---------- Account settings: change password / email, delete account ----------
// Each one asks for the current password first, so someone at an unlocked computer can't
// take over or delete the account. Checking the password also gives us a client with a
// real session, which Supabase needs for changing a user.

// Returns { client } logged in as this user, or { error: "<code>" }
async function verifyPassword(req, password) {
  if (!req.user || !req.user.email) return { error: "invalid" };
  const client = newClient();
  const { data, error } = await safely(() => client.auth.signInWithPassword({ email: req.user.email, password: String(password || "") }));
  if (error || !data.session) return { error: error ? errorCode(error) : "invalid" };
  return { client, session: data.session };
}

// Returns { cookies } on success, or { error: "<code>" }
async function changePassword(req, currentPassword, newPassword) {
  if (String(newPassword || "").length < 6) return { error: "weak" };
  const check = await verifyPassword(req, currentPassword);
  if (check.error) return check;
  const { error } = await safely(() => check.client.auth.updateUser({ password: newPassword }));
  if (error) return { error: error.code === "same_password" ? "same" : errorCode(error) };
  const { data } = await check.client.auth.getSession();
  return { cookies: sessionCookies(data.session || check.session) };
}

// Returns { email, pending } on success, or { error: "<code>" }. pending: Supabase sent a
// confirmation link and the change only happens once it's clicked ("Confirm email" on).
async function changeEmail(req, password, newEmail) {
  const email = String(newEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "email" };
  if (req.user && email === String(req.user.email || "").toLowerCase()) return { error: "sameemail" };
  const check = await verifyPassword(req, password);
  if (check.error) return check;
  const { data, error } = await safely(() => check.client.auth.updateUser({ email }));
  if (error) return { error: errorCode(error) };
  checkedTokens.clear(); // the cached user still has the old email
  const changed = (data.user && data.user.email || "").toLowerCase() === email;
  return { email: changed ? email : req.user.email, pending: !changed };
}

// Checks the password, then runs `removeData` (the caller deletes files etc.) and the
// delete_my_account() database function. Returns { cookies } that log out, or { error }.
async function deleteAccount(req, password, removeData) {
  const check = await verifyPassword(req, password);
  if (check.error) return check;
  await removeData();
  const { error } = await check.client.rpc("delete_my_account");
  if (error) throw error;
  checkedTokens.clear();
  return { cookies: clearedCookies() };
}

// Returns cookies that clear the session. Also tells Supabase to end it.
async function logOut(req) {
  const accessToken = readCookie(req, ACCESS_COOKIE);
  if (accessToken && isConfigured()) {
    try {
      await newClient().auth.admin.signOut(accessToken);
    } catch {
      // already expired or unreachable: clearing the cookies is enough
    }
  }
  return clearedCookies();
}

// ---------- Who's logged in ----------

// Remember checked tokens for a minute, so we don't ask Supabase on every request
const CHECK_CACHE_MS = 60_000;
const checkedTokens = new Map(); // access token → { user, checkedAt }

async function userForToken(accessToken) {
  const cached = checkedTokens.get(accessToken);
  if (cached && Date.now() - cached.checkedAt < CHECK_CACHE_MS) return cached.user;

  const { data, error } = await newClient().auth.getUser(accessToken);
  if (error && isAuthRetryableFetchError(error)) throw error; // Supabase unreachable, not a bad token
  if (error || !data.user) return null;

  if (checkedTokens.size > 1000) checkedTokens.clear(); // keep the cache small
  checkedTokens.set(accessToken, { user: data.user, checkedAt: Date.now() });
  return data.user;
}

// Call once at the start of each request. Figures out who's logged in, stores it
// on req.user (null if nobody), and refreshes the session cookies if needed.
async function loadUser(req, res) {
  req.user = null;
  req.accessToken = null;
  if (!isConfigured()) return;

  const accessToken = readCookie(req, ACCESS_COOKIE);
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (!accessToken && !refreshToken) return;

  try {
    // 1. Is the access token still good?
    if (accessToken) {
      const user = await userForToken(accessToken);
      if (user) {
        req.user = user;
        req.accessToken = accessToken;
        return;
      }
    }

    // 2. It ran out: trade the refresh token for a new session
    if (refreshToken) {
      const { data, error } = await newClient().auth.refreshSession({ refresh_token: refreshToken });
      if (error && isAuthRetryableFetchError(error)) throw error;
      if (!error && data.session && data.user) {
        req.user = data.user;
        req.accessToken = data.session.access_token;
        res.setHeader("Set-Cookie", sessionCookies(data.session));
        return;
      }
    }
  } catch (error) {
    console.error("Couldn't reach Supabase to check the login:", error.message);
    return; // treat as logged out, but keep the cookies in case Supabase comes back
  }

  // 3. Neither worked: the session is over, so clear the stale cookies
  res.setHeader("Set-Cookie", clearedCookies());
}

// ---------- For the rest of the team ----------

// The logged-in user's Supabase user ID, or null if nobody is logged in.
// Only works after loadUser(req, res) has run for this request.
function getUserId(req) {
  return req.user ? req.user.id : null;
}

function isLoggedIn(req) {
  return getUserId(req) !== null;
}

// A Supabase client that acts as the logged-in user, so Row Level Security
// policies apply. Use this for database queries, e.g.:
//   const { data } = await auth.supabaseFor(req).from("classes").select("*");
function supabaseFor(req) {
  return newClient(req.accessToken);
}

module.exports = {
  isConfigured, logIn, signUp, logOut, sendPasswordReset, resetPassword, loadUser, getUserId, isLoggedIn, supabaseFor,
  changePassword, changeEmail, deleteAccount,
};
