# StudySync: Team Plan

How we're splitting the work. Each person owns different files, so we shouldn't hit many merge conflicts.

## Where things stand

- The login is hard-coded (`admin` / `123` in `auth.js`), and sessions live in memory, so restarting the server logs everyone out.
- Everyone shares **one** calendar and **one** notebook. Data is saved as local files (`schedule.json`, `notebook-data/`).
- AI answers use `claude-opus-5-5` in `ai.js`, the most expensive model, and are billed to whoever's API key is in `.env`.

## Who does what

### Anthony: Supabase login

**Files:** `auth.js`, `pages/login.html`, the `/login` and `/logout` routes in `server.js`

- [ ] Create the Supabase project and share the keys privately with the team
- [ ] Replace the hard-coded check with Supabase Auth (email + password)
- [ ] Add a sign-up page
- [ ] Keep users logged in after a server restart
- [ ] Provide `getUserId(req)` for the rest of the team (see "Shared interface" below)

### Person 2: Data in Supabase, separate for each user

**Files:** `schedule.js`, `materials.js`, `chats.js`

- [ ] Create tables for calendar items, sources and chats, each with a `user_id` column
- [ ] Turn on Row Level Security so users only see their own rows
- [ ] Rewrite the load/save functions to use Supabase instead of JSON files
- [ ] Store uploaded PDFs in Supabase Storage
- [ ] Use a placeholder user ID until `getUserId(req)` is ready, then switch to it

### Person 3: Frontend, AI and demo

**Files:** `public/`, `pages/dashboard.html`, `ai.js`

- [ ] Polish the UI and check it on phone screens
- [ ] Switch `MODEL` in `ai.js` from Opus to Sonnet or Haiku to cut costs
- [ ] Set a spend limit on the team's Anthropic API key
- [ ] Deploy the app so judges can open a link (Render or Railway both run a plain Node server)
- [ ] Prepare the demo and pitch

## Shared interface

Anthony's login and Person 2's data work both depend on this. Agree on it first:

```js
// auth.js
// Returns the logged-in user's Supabase user ID, or null if nobody is logged in.
function getUserId(req) { ... }
```

Every function in `schedule.js`, `materials.js` and `chats.js` should take a `userId` as its first argument.

## Working together

- **Branches:** each person works on their own branch (`auth`, `data`, `ui`) and merges into `main` through a pull request.
- **`server.js` is shared.** Keep edits there small and pull from `main` often.
- **Secrets:** Supabase and Anthropic keys go in your own `.env` file, which is already in `.gitignore`. Never commit them, and don't use GitHub's drag-and-drop upload, because it ignores `.gitignore`.
- **Running it:** `npm install`, then `npm start`, then open http://localhost:3000. See `README.md` for details.
