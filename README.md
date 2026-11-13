# StudySync - Capitol Hacks 5.0 (Sacramento State)

A study dashboard for students. Plan your week, then study your course materials with an AI notebook that answers from *your* notes, with citations.

Built with plain Node.js (no framework), HTML, CSS and browser JavaScript. AI answers use the [Anthropic API](https://docs.anthropic.com).

## Features

**Login and loading screen**
- Sign up and log in with email and password (Supabase Auth), followed by a short loading screen, then the dashboard.

**Try the demo (no account)**
- **The welcome page** (`/`, `pages/welcome.html`) is what new visitors see first: what StudySync does, a live demo box they can click around in, and sign-up. Returning students log in at `/login`.
- **Try the demo** on the welcome page, or any link to **`/demo`** (handy for a QR code), opens the real app with a sample student's week: classes, two study groups with notes, course materials, a saved notebook chat and Canvas homework.
- Visitors can click around and change things; it's kept in server memory only (per visitor, for 3 hours) and never saved to Supabase. A banner on every page links to sign-up.
- The notebook gives real AI answers about the sample materials, limited to 8 questions per visitor and 120 an hour overall (`lib/demo.js`). PDF uploads, feedback and linking a real Canvas need an account.

**Feedback and feature ideas (on every page)**
- A **💡 Suggest a feature** button in the bottom corner of every main page (and *Suggest a feature · Report a bug* in the dashboard footer) opens a short form: feature idea, something broke, or general feedback.
- Works without an account too (welcome / login page, the demo): those reports have no user and an optional email, limited to 5 per visitor every 10 minutes. This needs the latest `supabase/schema.sql`.
- A link ending in `#feedback` (e.g. `https://your-site/#feedback`) opens the form right away.
- Read everything in Supabase → Table Editor → `feedback`. Demo visitors' reports have `[demo]` in the page column.

**Weekly calendar (Monday–Sunday)**
- Add **Classes** (with an optional room), **Tasks**, or **Other** items you name yourself (e.g. Work, Gym, Club).
- Pick one or more days, a start time and an end time.
- Each type has its own color family: classes are green/blue, tasks are red/orange, other items are purple. A color key sits next to "Your week".
- Today's column is highlighted. Remove an item with **×**.

**Virtual Notebook (Add Course Material)**
- Add sources by pasting text or uploading a **PDF, .txt or .md** file (drag and drop or click to choose). Each source belongs to one of your classes.
- Filter by course and tick which sources to use.
- Ask questions and get answers based only on the ticked sources, with numbered **citations** that show the exact quote (and page, for PDFs).
- One-tap **Summarize**, **Study guide**, **Quiz me** and **Key terms**.
- **Saved chats**: start a new chat any time, switch between chats from the dropdown, or delete them.

**Homework from Canvas**
- Link your Canvas account with your school's Canvas address and a personal access token (Canvas → Account → Settings → Approved Integrations → **+ New Access Token**).
- See your **Missing**, **Upcoming** and **Completed** homework, with scores, in three columns. Each one links to the assignment in Canvas. Work due within 2 days is highlighted.
- The token stays on the server and is never sent back to the browser. **Unlink** removes it.

**Less clutter**
- The Add section and the Virtual Notebook collapse and expand with the arrow button. The page remembers your choice.
- The layout adapts to phone screens.

## Getting started

### 1. Requirements
- [Node.js](https://nodejs.org) **v20.12 or newer**. The server uses `process.loadEnvFile`, which older versions don't have.

### 2. Install
```bash
git clone <this-repo-url>
cd StudySync
npm install
```

### 3. Connect Supabase (needed to log in)
1. Copy `.env.example` to a new file named **`.env`** in the project folder.
2. Get the team's Supabase project URL and **publishable (or anon) key**: Supabase dashboard → Project Settings → API. Never use the secret / service-role key here.
3. Put them in `.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-publishable-or-anon-key
   ```

### 4. (Optional) Turn on AI answers
The notebook works without AI: you can add and organize sources. To get answers:

Pick one provider:

- **Free (Gemini, good for demos):** get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then add to `.env`:
  ```
  AI_PROVIDER=gemini
  GEMINI_API_KEY=your-key
  ```
  The free tier has low rate limits (fine for a demo, not for lots of users at once), and Google can use free-tier prompts to improve its products, so use test materials.
- **Paid (Claude):** create a key at [console.anthropic.com](https://console.anthropic.com) (requires billing), then add to `.env`:
  ```
  AI_PROVIDER=anthropic
  ANTHROPIC_API_KEY=sk-ant-your-key-here
  ```

Then start (or restart) the server. Switching later is just changing `AI_PROVIDER` and restarting.

> **Never commit `.env`.** It's already listed in `.gitignore`. Use git to upload the project. GitHub's drag-and-drop "Upload files" button ignores `.gitignore` and could upload your key.

### 5. Run
```bash
node server.js
```
Then open **http://localhost:3000**, click **Create an account**, and sign up with your email and a password.

If Supabase has **Confirm email** turned on (Authentication → Sign In / Providers → Email), you'll get a confirmation email first. Turning it off makes testing faster.

**Other ways to run it:**
- `node --watch server.js` restarts the server automatically whenever you save a server file.
- In VS Code, press **F5** (uses `.vscode/launch.json`). It opens the browser for you; restart with **Cmd/Ctrl+Shift+F5**.

**When to restart:**
- Changes in `pages/` and `public/` show up with a browser refresh.
- Changes to `server.js`, `routes/` and `lib/` need a server restart.
- Run `npm test` after changing server code. It starts its own copy on port 3999 and checks every page and API route against `test/baseline.json`. If you meant to change a route's answer, record the new baseline with `npm test -- --save`.

## Project structure

```
StudySync/
├── server.js         Starts the server, works out who's asking, sends each request to its route
├── routes/           Which URL does what, one file per part of the app
│   ├── pages.js        Pages, login / sign-up / password forms, the demo, feedback
│   ├── account.js      Account settings, who's logged in
│   ├── study.js        Profile, weekly study plan + quick edits, "I studied" checkmarks
│   ├── schedule.js     Calendar items, course catalog and sections
│   ├── groups.js       Study groups, meetups, session chat
│   ├── notebook.js     Study assistant: materials, saved chats, asking the AI
│   └── canvas.js       Linking Canvas, loading homework
├── lib/              The work behind the routes
│   ├── http.js         Sending pages / JSON, reading requests, the router
│   ├── auth.js         Login with Supabase, who's logged in (getUserId, supabaseFor)
│   ├── onboarding.js   Profile: name, alone or in a group, weekly study goal
│   ├── schedule.js     Calendar items → Supabase "classes" table
│   ├── courses.js      The Sac State course catalog students pick their classes from
│   ├── sections.js     Each class's sections from Sac State's class schedule
│   ├── groups.js       Study groups: one per class, matched by shared free time
│   ├── meetups.js      Next session, RSVPs, moving a session, meeting spot, session chat
│   ├── studyplan.js    Weekly study times (AI if there's a key, else public/planner.js)
│   ├── studylog.js     "I studied" checkmarks
│   ├── materials.js    Notebook sources → Supabase "sources" table + Storage
│   ├── chats.js        Notebook chats → Supabase "chats" table
│   ├── ai.js           Sends sources + questions to the AI (ai-gemini.js / ai-anthropic.js)
│   ├── canvas.js       Canvas account → "canvas_connections" table, loads homework
│   ├── feedback.js     Feedback reports → "feedback" table
│   ├── limits.js       Rate limits
│   ├── namefilter.js   Word filter for names and chat messages
│   └── demo.js         "Try the demo": sample data in memory, answers /api/ for demo visitors
├── pages/            HTML for each page
├── public/           CSS and browser JavaScript (format.js and colors.js are shared helpers)
├── supabase/schema.sql  Creates the tables, security rules and group matching (run in Supabase)
├── supabase/courses.sql Every Sac State course, for the class picker (run after schema.sql)
├── scripts/import-courses.js  Rebuilds courses.sql from catalog.csus.edu (run each semester or two)
├── scripts/smoke-test.js      npm test: checks every page and API route still answers the same
├── .env              Your keys: Supabase, Gemini or Anthropic (you create this; never committed)
├── .env.example      Template for .env
└── package.json      Dependencies
```

### Where your data lives
Everything is saved in Supabase, separately for each student:

| Data | Where |
|---|---|
| Calendar items | `classes` table |
| Notebook sources | `sources` table (pasted text) + `sources` Storage bucket (PDFs, in a folder per user) |
| Notebook chats | `chats` table |

Row Level Security makes sure each student can only see and change their own rows and files. To set it up in a new Supabase project, run `supabase/schema.sql` in the Supabase SQL Editor, then `supabase/courses.sql` (the class list). Both are safe to run again, and `schema.sql` needs re-running whenever it changes.

### Classes and study groups
Students pick their classes from the Sac State catalog (`courses` table), so everyone in the same class matches, whatever section they're in. Cross-listed courses (e.g. EEE 64 and CPE 64) count as one class. A class that isn't in the catalog can still be typed in; it matches students who type the same name.

Each student who wants groups gets one group per class (up to 4 people), meeting weekly in a 90-minute slot when every member is free: weekdays 9 AM – 9 PM, weekends 10 AM – 6 PM. A student's groups never clash with each other or with their schedule. Matching runs in the database (`match_study_group()` in `schema.sql`) whenever a student opens their study plan or changes their schedule.

Each group's page aims to get a group from matched to meeting without anyone having to message each other (`lib/meetups.js`):
- **Next session**: the date, time and place, plus **Going / Running late / Can't make it** for each member.
- **Find a time that works for everyone**: if someone can't make it, StudySync lists times in the next week when every member is free (their classes, tasks and other groups are checked by `group_free_slots` in the database), and one tap moves that week's session. Everyone answers again for the new time.
- **Talk it over**: a small chat for each week's session, to settle details like the time. It starts fresh every week, so it stays about the next session instead of becoming a group chat. The page checks for new messages every 5 seconds while it's open; messages go through a light word filter, and members need a name on their account to post.
- **Where we're meeting**: members suggest places and vote, and anyone can make one the meeting spot.

These need the latest `supabase/schema.sql`.

To refresh the class list (new semester): `node scripts/import-courses.js`, then run the new `supabase/courses.sql`.

Which sections are collapsed and which chat was last open are stored in your browser only.

## Customizing

- **Calendar colors:** edit `COLOR_FAMILIES` at the top of `public/colors.js`. It's the only place colors are set; the cards and the color key both read from it. Hues: 0 red · 60 yellow · 120 green · 200 blue · 270 purple · 330 pink.
- **Loading screen time:** `LOADING_TIME_MS` in `pages/loading.html`.
- **AI model and answer depth:** `MODEL` and `effort` in `lib/ai.js`. It defaults to the most capable model at `medium` effort.
- **AI instructions:** `SYSTEM_PROMPT` in `lib/ai.js`.
- **Quick buttons (Summarize, Quiz me…):** `QUICK_PROMPTS` in `public/notebook.js`.
- **Make another section collapsible:** see the comment at the top of `public/collapse.js`.

## API routes

All `/api/` routes require being logged in.

| Method | Route | What it does |
|---|---|---|
| GET / POST | `/api/classes` | List / add calendar items |
| DELETE | `/api/classes/:id` | Remove a calendar item |
| GET / POST | `/api/sources` | List / add notebook sources |
| DELETE | `/api/sources/:id` | Remove a source |
| GET | `/api/notebook/status` | Whether AI answers are on |
| POST | `/api/notebook/ask` | Ask the AI (starts or continues a chat) |
| GET | `/api/chats` | List saved chats |
| GET / DELETE | `/api/chats/:id` | Open / delete a chat |
| POST / DELETE | `/api/canvas/connect` | Link Canvas with `{ feedUrl }` (Calendar Feed) or `{ canvasUrl, token }`, checked with Canvas first / unlink it |
| GET | `/api/canvas/status` | `{ connected, canvasUrl, mode }`, mode is `feed` or `token` (never the link or token) |
| GET | `/api/canvas/assignments` | Homework sorted into `missing`, `completed` and `upcoming` |
| POST | `/api/canvas/done` | Calendar Feed only: tick an assignment off, `{ id, done }` |

## Good to know

- **This is a learning project, not production-ready.** Canvas tokens are stored as plain text in Supabase, readable only by the server.
- **AI answers with Gemini's free tier cost nothing** but are rate-limited ("The free AI limit was reached" means wait a minute).
- **AI answers with Claude cost money.** They're billed to the API key's Anthropic account. A question about a ~20-page PDF costs roughly 10–15¢. Follow-ups on the same sources are cheaper thanks to caching. Consider setting a spending limit in the Anthropic Console.
- **Limits:** PDFs up to 10 MB, pasted or text files up to 500,000 characters per source.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE: address already in use :::3000` | Another copy of the server is running. Stop it, or run `lsof -ti:3000 \| xargs kill` (macOS/Linux) |
| "AI answers are off" box still showing | Check that `.env` is in the project folder and spelled correctly, then restart the server |
| "The Anthropic API key in .env isn't valid" / "The Gemini API key in .env isn't valid" | The key is wrong or expired. Paste a new key into `.env` and restart |
| "The Gemini model ... wasn't found" | Set `GEMINI_MODEL` in `.env` to a current model name from Google AI Studio and restart |
| Changes not showing up | Refresh the browser. For changes to `.js` files in the main folder, restart the server |
| `Cannot find module '@anthropic-ai/sdk'` | Run `npm install` |
