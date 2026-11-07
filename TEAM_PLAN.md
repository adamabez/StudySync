# StudySync: Team Plan

How we're splitting the work. Each person owns different files, so we shouldn't hit many merge conflicts.

## Where things stand

- The login is hard-coded (`admin` / `123` in `auth.js`), and sessions live in memory, so restarting the server logs everyone out.
- Everyone shares **one** calendar and **one** notebook. Data is saved as local files (`schedule.json`, `notebook-data/`).
- AI answers use the most expensive model (`MODEL` in `ai.js`) and are billed to whoever's API key is in `.env`.

## The big new feature: Canvas

Users link their Canvas account, and the dashboard shows their **missing** and **completed** homework assignments.

## Who does what

### Anthony: Supabase and login

**Files:** `auth.js`, `pages/login.html`, `schedule.js`, `materials.js`, `chats.js`, the `/login` and `/logout` routes in `server.js`

Login:
- [ ] Create the Supabase project and share the keys privately with the team
- [ ] Replace the hard-coded check with Supabase Auth (email + password)
- [ ] Add a sign-up page
- [ ] Keep users logged in after a server restart
- [ ] Provide `getUserId(req)` (see "Shared interfaces" below)

Data for each user:
- [ ] Create tables for calendar items, sources and chats, each with a `user_id` column
- [ ] Create a `canvas_connections` table for Gurkirat (see below)
- [ ] Turn on Row Level Security so users only see their own rows
- [ ] Rewrite the load/save functions in `schedule.js`, `materials.js` and `chats.js` to use Supabase instead of JSON files
- [ ] Store uploaded PDFs in Supabase Storage

### Gurkirat: Canvas integration

**Files:** a new `canvas.js`, the `/api/canvas/...` routes in `server.js`

- [ ] Let a user connect Canvas with a **personal access token**. In Canvas, it's under Account → Settings → Approved Integrations → **+ New Access Token**. Full OAuth needs the school's Canvas admin to issue a developer key, so a token is the realistic choice for a hackathon.
- [ ] Save the token and the school's Canvas URL in the `canvas_connections` table, linked to the user. Tokens stay on the server and never get sent to the browser.
- [ ] Fetch assignments from the Canvas API:
  - Courses: `GET /api/v1/courses?enrollment_state=active`
  - Assignments with the user's submission: `GET /api/v1/courses/:id/assignments?include[]=submission`
  - Missing work: `GET /api/v1/users/self/missing_submissions`
  - Send the token as the header `Authorization: Bearer <token>`. Canvas splits long lists into pages, so follow the `Link` header to get every page.
- [ ] Sort assignments into **missing**, **completed** (submitted or graded) and **upcoming**
- [ ] Add the routes listed under "Shared interfaces"
- [ ] Until the login is ready, test with your own token in `.env` (`CANVAS_TOKEN=...`, `CANVAS_URL=...`)

### Adam: Frontend, night mode and demo

**Files:** `public/`, `pages/`, except `pages/login.html` and the sign-up page, `ai.js`

- [ ] Night mode (dark theme) with a toggle that the browser remembers
- [ ] A "Connect Canvas" form (Canvas URL + token) and a homework panel showing missing and completed assignments
- [ ] Until Gurkirat's routes are ready, build the panel from fake data shaped like the example under "Shared interfaces"
- [ ] Polish the UI and check it on phone screens
- [ ] Switch `MODEL` in `ai.js` to a cheaper model to cut costs, and set a spend limit on the team's Anthropic API key
- [ ] Deploy the app so judges can open a link (Render or Railway both run a plain Node server)
- [ ] Prepare the demo and pitch. Use a Canvas account with real assignments, or have a backup plan if the Wi-Fi fails.

## Shared interfaces

Agree on these first, so everyone can build at the same time with placeholders.

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

You never need to send `user_id` when inserting: the database fills it in with the logged-in user. The tables are created by `supabase/schema.sql`.

**Anthony → Gurkirat:** the `canvas_connections` table

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

- **Branches:** each person works on their own branch (`auth`, `canvas`, `ui`) and merges into `main` through a pull request.
- **`server.js` is shared.** Keep edits there small and pull from `main` often. Gurkirat only adds `/api/canvas/...` routes, and Anthony only touches login/logout.
- **Secrets:** Supabase, Canvas and Anthropic keys go in your own `.env` file, which is already in `.gitignore`. Never commit them, and don't use GitHub's drag-and-drop upload, because it ignores `.gitignore`.
- **Running it:** `npm install`, then `npm start`, then open http://localhost:3000. See `README.md` for details.
