# StudySync: Team Plan

How we're splitting the work. Each person owns different files, so we shouldn't hit many merge conflicts.

## Status (updated Nov 7)

| Person | Area | Status |
|---|---|---|
| Anthony | Supabase, login, per-student data | ✅ Done and merged into `main` |
| Gurkirat | Canvas integration | ✅ Done on the `canvas` branch: `canvas.js` + the `/api/canvas/...` routes. Adam can switch the homework panel from fake data to the real routes |
| Adam | Frontend, night mode, deploy, demo | ⏳ Not on `main` yet |

## Where things stand

- Students sign up and log in with email + password (Supabase Auth). Logins survive server restarts, and there's "Forgot password?".
- Each student has their **own** calendar, notebook sources (text + PDFs) and saved chats, stored in Supabase. Row Level Security makes sure nobody can see anyone else's data.
- Classes can be **asynchronous** (no set time).
- AI answers still use the most expensive model (`MODEL` in `ai.js`) and are billed to whoever's API key is in `.env`.

## The big new feature: Canvas

Users link their Canvas account, and the dashboard shows their **missing** and **completed** homework assignments.

## Who does what

### Anthony: Supabase and login ✅

**Files:** `auth.js`, `pages/login.html`, `pages/signup.html`, `pages/forgot.html`, `pages/reset-password.html`, `schedule.js`, `materials.js`, `chats.js`, `supabase/schema.sql`, the login/logout routes in `server.js`

Login:
- [x] Create the Supabase project and share the keys privately with the team
- [x] Replace the hard-coded check with Supabase Auth (email + password)
- [x] Add a sign-up page
- [x] Keep users logged in after a server restart
- [x] Provide `getUserId(req)` and `supabaseFor(req)` (see "Shared interfaces" below)

Data for each user:
- [x] Create tables for calendar items, sources and chats, each with a `user_id` column
- [x] Create a `canvas_connections` table for Gurkirat (see below)
- [x] Turn on Row Level Security so users only see their own rows
- [x] Rewrite the load/save functions in `schedule.js`, `materials.js` and `chats.js` to use Supabase instead of JSON files
- [x] Store uploaded PDFs in Supabase Storage

Extras:
- [x] "Forgot password?" with an email reset link
- [x] Account circle on the dashboard: shows your email and Log out on hover, Tab or tap
- [x] Asynchronous classes (no set time, days optional)
- [x] Arrow buttons for collapsing sections

Next:
- [ ] Help Gurkirat with Canvas
- [ ] Help with deployment: enter `SUPABASE_URL` and `SUPABASE_KEY` on the hosting site, and add the live site's `/reset-password` address in Supabase → Authentication → URL Configuration → Redirect URLs

### Gurkirat: Canvas integration

**Files:** a new `canvas.js`, the `/api/canvas/...` routes in `server.js`

The login and the `canvas_connections` table are ready, so this can use real users now.

- [x] Let a user connect Canvas with a **personal access token**. In Canvas, it's under Account → Settings → Approved Integrations → **+ New Access Token**. Full OAuth needs the school's Canvas admin to issue a developer key, so a token is the realistic choice for a hackathon.
- [x] Save the token and the school's Canvas URL in the `canvas_connections` table, linked to the user. Tokens stay on the server and never get sent to the browser.
- [x] Fetch assignments from the Canvas API:
  - Courses: `GET /api/v1/courses?enrollment_state=active`
  - Assignments with the user's submission: `GET /api/v1/courses/:id/assignments?include[]=submission`
  - Missing work: `GET /api/v1/users/self/missing_submissions`
  - Send the token as the header `Authorization: Bearer <token>`. Canvas splits long lists into pages, so follow the `Link` header to get every page.
- [x] Sort assignments into **missing**, **completed** (submitted or graded) and **upcoming**
- [x] Add the routes listed under "Shared interfaces"

Notes for Adam:
- If the saved token stops working, `/api/canvas/assignments` answers **409** with `{ error, reconnect: true }` (not 401, which means "not logged in"). Show the Connect Canvas form again.
- `POST /api/canvas/connect` answers `{ connected, canvasUrl, name }`, where `name` is the student's name in Canvas. Errors come back as `{ error }` with a message you can show as-is.
- In `completed`, `score` is `null` until the assignment is graded.

### Adam: Frontend, night mode and demo

**Files:** `public/`, `pages/` (except the login, sign-up and password pages), `ai.js`

The dashboard changed a lot (account circle, async classes, arrow buttons), so pull `main` before starting night mode.

- [ ] Night mode (dark theme) with a toggle that the browser remembers
- [ ] A "Connect Canvas" form (Canvas URL + token) and a homework panel showing missing and completed assignments
- [ ] Until Gurkirat's routes are ready, build the panel from fake data shaped like the example under "Shared interfaces"
- [ ] Polish the UI and check it on phone screens
- [ ] Switch `MODEL` in `ai.js` to a cheaper model to cut costs, and set a spend limit on the team's Anthropic API key
- [ ] Deploy the app so judges can open a link (Render or Railway both run a plain Node server)
- [ ] Prepare the demo and pitch. Use a Canvas account with real assignments, or have a backup plan if the Wi-Fi fails.

## Shared interfaces

**Anthony → everyone**

```js
// auth.js
// Returns the logged-in user's Supabase user ID, or null if nobody is logged in.
function getUserId(req) { ... }
```

Every function in `schedule.js`, `materials.js` and `chats.js` takes `db` as its first argument: the Supabase client for the logged-in user. `canvas.js` should do the same:

```js
const db = auth.supabaseFor(req);   // acts as the logged-in user, so Row Level Security applies
const { data, error } = await db.from("canvas_connections").select("*").maybeSingle();
```

You never need to send `user_id` when inserting: the database fills it in with the logged-in user. The tables are created by `supabase/schema.sql`, which has already been run in our Supabase project.

**Anthony → Gurkirat:** the `canvas_connections` table (already created)

| Column | Type |
|---|---|
| `user_id` | uuid, the Supabase user, primary key |
| `canvas_url` | text, e.g. `https://<school>.instructure.com` |
| `access_token` | text, server-only |
| `created_at` | timestamp |

**Gurkirat → Adam:** the routes

| Method | Route | What it does |
|---|---|---|
| POST | `/api/canvas/connect` | Body `{ canvasUrl, token }`. Checks the token works, then saves it |
| GET | `/api/canvas/status` | `{ connected: true/false }` |
| GET | `/api/canvas/assignments` | The homework list (below) |
| DELETE | `/api/canvas/connect` | Unlinks Canvas |

What `/api/canvas/assignments` returns:

```json
{
  "missing": [
    { "id": "123", "name": "Lab 4", "course": "CSC 130", "dueAt": "2026-11-05T23:59:00Z", "url": "https://..." }
  ],
  "completed": [
    { "id": "124", "name": "Quiz 3", "course": "MATH 30", "dueAt": "2026-11-03T23:59:00Z", "url": "https://...", "score": 9, "pointsPossible": 10 }
  ],
  "upcoming": [
    { "id": "125", "name": "Essay draft", "course": "ENGL 20", "dueAt": "2026-11-10T23:59:00Z", "url": "https://..." }
  ]
}
```

## Working together

- **Branches:** `main` is the real project. Start each task on a new branch from `main` (e.g. `git checkout -b canvas`) and merge it back through a pull request. `backup-anthony` is a saved copy of `main` from Nov 7; don't work on it.
- **`server.js` is shared.** Keep edits there small and pull from `main` often. Gurkirat only adds `/api/canvas/...` routes.
- **Secrets:** Supabase, Canvas and Anthropic keys go in your own `.env` file (copy `.env.example`), which is already in `.gitignore`. Never commit them, and don't use GitHub's drag-and-drop upload, because it ignores `.gitignore`.
- **Running it:** `npm install`, then `npm start`, then open http://localhost:3000. See `README.md` for details.
