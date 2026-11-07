# StudySync - Capitol Hacks 5.0 (Sacramento State)

A study dashboard for students. Plan your week, then study your course materials with an AI notebook that answers from *your* notes, with citations.

Built with plain Node.js (no framework), HTML, CSS and browser JavaScript. AI answers use the [Claude API](https://platform.claude.com/docs).

## Features

**Login and loading screen**
- A simple practice login, followed by a short loading screen, then the dashboard.

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

**Less clutter**
- The Add section and the Virtual Notebook collapse with **−** and expand with **+**. The page remembers your choice.
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

### 3. (Optional) Turn on AI answers
The notebook works without AI: you can add and organize sources. To get answers:

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) (requires billing).
2. Create a file named **`.env`** in the project folder:
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
3. Start (or restart) the server.

> **Never commit `.env`.** It's already listed in `.gitignore`. Use git to upload the project. GitHub's drag-and-drop "Upload files" button ignores `.gitignore` and could upload your key.

### 4. Run
```bash
node server.js
```
Then open **http://localhost:3000** and log in with:

| Username | Password |
|---|---|
| `admin` | `123` |

**Other ways to run it:**
- `node --watch server.js` restarts the server automatically whenever you save a server file.
- In VS Code, press **F5** (uses `.vscode/launch.json`). It opens the browser for you; restart with **Cmd/Ctrl+Shift+F5**.

**When to restart:**
- Changes in `pages/` and `public/` show up with a browser refresh.
- Changes to `.js` files in the main folder need a server restart.

## Project structure

```
StudySync/
├── server.js         Starts the server and decides what each URL does (routes)
├── auth.js           Login check and who's logged in
├── schedule.js       Saves/loads calendar items → schedule.json
├── materials.js      Saves/loads notebook sources → notebook-data/
├── chats.js          Saves/loads notebook chats → notebook-data/chats.json
├── ai.js             Sends sources + questions to Claude, formats citations
├── pages/            HTML for each page (login, loading, dashboard, 404)
├── public/           CSS and browser JavaScript
│   ├── style.css       Shared look (card, buttons, inputs, spinner)
│   ├── dashboard.css   Calendar and Add form
│   ├── dashboard.js    Calendar logic and colors (COLOR_FAMILIES)
│   ├── notebook.css    Virtual Notebook
│   ├── notebook.js     Sources, drop zone, chat and saved chats
│   └── collapse.js     − / + collapsible sections
├── .vscode/launch.json  F5 run setup for VS Code
├── .env              Your API key (you create this; never committed)
└── package.json      Dependencies (@anthropic-ai/sdk)
```

### Where your data lives
Everything you add is saved as files next to the code, so it survives restarts:

| Data | File |
|---|---|
| Calendar items | `schedule.json` |
| Notebook sources | `notebook-data/sources.json` + one `.txt`/`.pdf` per source |
| Notebook chats | `notebook-data/chats.json` |

These files are created automatically and are **ignored by git**, so your personal data never ends up on GitHub. Someone who downloads the project starts with an empty calendar and notebook.

Which sections are collapsed and which chat was last open are stored in your browser only.

## Customizing

- **Calendar colors:** edit `COLOR_FAMILIES` at the top of `public/dashboard.js`. It's the only place colors are set; the cards and the color key both read from it. Hues: 0 red · 60 yellow · 120 green · 200 blue · 270 purple · 330 pink.
- **Loading screen time:** `LOADING_TIME_MS` in `pages/loading.html`.
- **AI model and answer depth:** `MODEL` and `effort` in `ai.js`. It defaults to Claude Opus 5.5 at `medium` effort.
- **AI instructions:** `SYSTEM_PROMPT` in `ai.js`.
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
| POST | `/api/notebook/ask` | Ask Claude (starts or continues a chat) |
| GET | `/api/chats` | List saved chats |
| GET / DELETE | `/api/chats/:id` | Open / delete a chat |

## Good to know

- **This is a learning project, not production-ready.** The login is hard-coded in `auth.js` (`admin` / `123`), everyone shares one calendar and notebook, and logins are kept in memory, so restarting the server logs you out.
- **AI answers cost money.** They're billed to the API key's Anthropic account. A question about a ~20-page PDF costs roughly 10–15¢. Follow-ups on the same sources are cheaper thanks to caching. Consider setting a spending limit in the Anthropic Console.
- **Limits:** PDFs up to 10 MB, pasted or text files up to 500,000 characters per source.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE: address already in use :::3000` | Another copy of the server is running. Stop it, or run `lsof -ti:3000 \| xargs kill` (macOS/Linux) |
| "AI answers are off" box still showing | Check that `.env` is in the project folder and spelled correctly, then restart the server |
| "The Anthropic API key in .env isn't valid" | The key is wrong or expired. Paste a new key into `.env` and restart |
| Changes not showing up | Refresh the browser. For changes to `.js` files in the main folder, restart the server |
| `Cannot find module '@anthropic-ai/sdk'` | Run `npm install` |
