// StudySync - study groups. Students don't create or join groups themselves:
// match_study_group() in the database (see supabase/schema.sql) puts students who
// want a group into one that meets when they're all free.
//
// Every function takes `db` first: the Supabase client for the logged-in user,
// from auth.supabaseFor(req). Students only see their own group and its members.

const { DAY_KEYS } = require("./schedule");

// Find the logged-in student a group if they want one and don't have one yet.
// Run after anything that could change the match: setup, preference, schedule changes.
async function match(db) {
  const { error } = await db.rpc("match_study_group");
  if (error) throw error;
}

// Same, but never fails the request it's attached to (e.g. saving a class)
async function matchQuietly(db) {
  try {
    await match(db);
  } catch (error) {
    console.error("Study group matching failed (run supabase/schema.sql again?):", error.message || error);
  }
}

// A group's members by name (never email): [{ userId, name, isYou }]
async function loadMembers(db, groupId, userId) {
  const { data, error } = await db.rpc("group_member_names", { gid: groupId });
  if (error) throw error;
  return data.map((m) => ({ userId: m.user_id, name: m.name, isYou: m.user_id === userId }));
}

function groupFromRow(row, members) {
  return {
    id: row.id,
    name: row.name,
    course: row.course,
    days: DAY_KEYS.filter((d) => row.days.includes(d)),
    start: row.start_time,
    end: row.end_time,
    members,
  };
}

// ---------- Class Discord server ----------
// One Discord server per class (course_discord in schema.sql), shared by every group in it.
// Anyone taking the class can set, change or remove it.
//
// PAUSED: switched off for now (the card is hidden and the API ignores it). The code below
// stays so it can come back later: set DISCORD_ENABLED to true to turn it back on.
const DISCORD_ENABLED = false;

// Accepts discord.gg/abc, https://discord.com/invite/abc, etc. Returns the clean
// https://discord.gg/<code> link, "" for empty (remove it), or null if it isn't a Discord invite.
function normalizeDiscordUrl(input) {
  let text = typeof input === "string" ? input.trim() : "";
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = "https://" + text;
  let url;
  try { url = new URL(text); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  let code = null;
  if (host === "discord.gg") code = path.slice(1);
  else if (["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com"].includes(host)) {
    const m = path.match(/^\/invite\/(.+)$/);
    if (m) code = m[1];
  }
  if (!code || !/^[A-Za-z0-9-]{2,64}$/.test(code)) return null;
  return "https://discord.gg/" + code;
}

const DISCORD_ERROR = "That doesn't look like a Discord invite link (e.g. https://discord.gg/abc123).";
const DISCORD_EXPIRED = "That invite doesn't work. It may have expired: in Discord, make a new invite and set it to never expire.";

// Server name, icon and member counts from Discord's public invite lookup (no login needed).
// Returns { name, iconUrl, members, online }, { expired: true } if Discord says the invite
// is dead, or null if Discord couldn't be reached. Cached so page views don't each ask Discord.
const INVITE_CACHE_MS = 15 * 60 * 1000;
const inviteCache = new Map(); // code → { at, info }

async function lookupInvite(link) {
  const code = link.slice("https://discord.gg/".length);
  const cached = inviteCache.get(code);
  if (cached && Date.now() - cached.at < INVITE_CACHE_MS) return cached.info;

  let info = null;
  try {
    const res = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`, {
      headers: { "User-Agent": "StudySync (study groups, 1.0)" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) info = { expired: true };
    else if (res.ok) {
      const data = await res.json();
      const guild = data.guild || {};
      // Only build the icon link from Discord's ID/hash formats, never from arbitrary text
      const iconUrl = /^\d{5,25}$/.test(guild.id || "") && /^(a_)?[0-9a-f]{32}$/.test(guild.icon || "")
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
        : "";
      info = {
        name: typeof guild.name === "string" ? guild.name.slice(0, 100) : "",
        iconUrl,
        // For "Open in Discord" (discord.com/channels/<id>), only if it looks like a Discord ID
        guildId: /^\d{5,25}$/.test(guild.id || "") ? guild.id : "",
        members: Number.isFinite(data.approximate_member_count) ? data.approximate_member_count : null,
        online: Number.isFinite(data.approximate_presence_count) ? data.approximate_presence_count : null,
      };
    }
  } catch (error) {
    console.error("Discord invite lookup failed:", error.message || error);
  }
  if (info) {
    if (inviteCache.size > 500) inviteCache.clear(); // keep memory bounded
    inviteCache.set(code, { at: Date.now(), info });
  }
  return info;
}

// What the browser gets: { url, name, iconUrl, members, online, expired }, or null for no link.
// If Discord can't be reached, just the link (the page still shows a Join button).
async function discordForBrowser(link) {
  if (!link) return null;
  const info = await lookupInvite(link);
  return { url: link, name: "", iconUrl: "", guildId: "", members: null, online: null, expired: false, ...(info || {}) };
}

// Check a link someone typed. Returns { link } ("" = remove it) or { error }.
async function checkDiscordInput(input) {
  const link = normalizeDiscordUrl(input && input.discordUrl);
  if (link === null) return { error: DISCORD_ERROR };
  if (link && (await lookupInvite(link))?.expired) return { error: DISCORD_EXPIRED };
  return { link };
}

// The class's Discord invite link ("" if none yet). `group` comes from getGroup.
async function getClassDiscordLink(db, group) {
  if (!group.course) return "";
  const { data, error } = await db.from("course_discord").select("invite_url").eq("course", group.course).maybeSingle();
  if (error) throw error;
  return (data && normalizeDiscordUrl(data.invite_url)) || ""; // older rows may be in another invite format
}

// Set or clear the class's Discord invite link. Returns { value } or { error }.
async function setDiscord(db, group, input) {
  if (!group.course) return { error: "This group isn't linked to a class, so it can't have a class Discord." };
  const checked = await checkDiscordInput(input);
  if (checked.error) return checked;
  const { error } = checked.link
    ? await db.from("course_discord").upsert(
      { course: group.course, invite_url: checked.link, updated_at: new Date().toISOString() },
      { onConflict: "course" })
    : await db.from("course_discord").delete().eq("course", group.course);
  if (error) throw error;
  return { value: { discord: await discordForBrowser(checked.link) } };
}

// What the browser gets for a member: no user IDs
function memberForBrowser({ name, isYou }) {
  return { name, isYou };
}

// The student's group(s), with who's in each
async function listMyGroups(db, userId) {
  const { data, error } = await db.from("study_groups").select("*").order("created_at");
  if (error) throw error;
  return Promise.all(data.map(async (row) => {
    const members = await loadMembers(db, row.id, userId);
    return groupFromRow(row, members.map(memberForBrowser));
  }));
}


// Each of the student's classes and whether they're in a group for it yet:
// [{ courseKey, label, hasGroup }]. The landing page lists the ones still waiting.
async function listClassGroups(db) {
  const { data, error } = await db.rpc("my_class_groups");
  if (error) throw error;
  return data.map((row) => ({ courseKey: row.course_key, label: row.label, hasGroup: row.has_group }));
}

// ---------- One group's page: details + shared notes ----------

// The group with this ID, or null if it doesn't exist or the student isn't in it
// (Row Level Security hides other groups). Members include userId for matching note authors.
async function getGroup(db, groupId, userId) {
  const { data: row, error } = await db.from("study_groups").select("*").eq("id", groupId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  return groupFromRow(row, await loadMembers(db, groupId, userId));
}

// The group's notes, newest first. `group` comes from getGroup (for authors' names).
async function listNotes(db, group, userId) {
  const { data, error } = await db
    .from("group_notes")
    .select("id, user_id, title, body, created_at")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const names = new Map(group.members.map((m) => [m.userId, m.name]));
  return data.map((row) => noteForBrowser(row, names, userId));
}

function noteForBrowser(row, names, userId) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    author: names.get(row.user_id) || "A former member",
    isYours: row.user_id === userId,
  };
}

// Check and save a note. Returns { value } or { error }.
async function addNote(db, group, userId, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 120) return { error: "Give the note a title (120 characters max)." };
  if (!body) return { error: "The note is empty." };
  if (body.length > 20_000) return { error: "Notes can be 20,000 characters max." };

  const { data, error } = await db
    .from("group_notes")
    .insert({ group_id: group.id, title, body })
    .select("id, user_id, title, body, created_at")
    .single();
  if (error) throw error;
  const names = new Map(group.members.map((m) => [m.userId, m.name]));
  return { value: noteForBrowser(data, names, userId) };
}

// Delete one of your own notes (Row Level Security stops you deleting anyone else's)
async function removeNote(db, groupId, noteId) {
  const { error } = await db.from("group_notes").delete().eq("id", noteId).eq("group_id", groupId);
  if (error) throw error;
}

module.exports = {
  match, matchQuietly, listMyGroups, listClassGroups, getGroup, memberForBrowser,
  listNotes, addNote, removeNote, DISCORD_ENABLED, setDiscord, getClassDiscordLink, checkDiscordInput, discordForBrowser,
};
