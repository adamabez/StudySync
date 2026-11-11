// StudySync - deciding where a study group meets, and connecting it to Discord.
// StudySync is the one place for where and when; the conversation happens on Discord.
//
//   Spots     Members suggest places and vote. Anyone can make one "the spot".
//   Discord   Each class has one Discord server (course_discord, shared by every group in
//             the class). Each group links its own channel there (group_discord), and can add
//             the channel's webhook so StudySync posts when the meeting spot is set.
//
// Tables and security rules: the "Meetups and Discord" part of supabase/schema.sql.
// Every function takes `db` first: the Supabase client for the logged-in user.

const { checkMessage } = require("./namefilter");

const MAX_PLACE = 120;
const MAX_SPOTS = 8; // suggestions per group, so the list stays short

// ---------- Checking links ----------

// "discord.gg/abc" → "https://discord.gg/abc"; anything else that isn't an invite → null
function cleanInvite(text) {
  let url = String(text || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return /^https:\/\/(www\.)?(discord\.gg|discord(app)?\.com\/invite)\/[A-Za-z0-9-]{2,32}\/?$/i.test(url.replace(/^http:/i, "https:"))
    ? url.replace(/^http:/i, "https:").replace(/\/$/, "")
    : null;
}

// A link to a channel: https://discord.com/channels/<server>/<channel>
function cleanChannel(text) {
  let url = String(text || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return /^https:\/\/((www|ptb|canary)\.)?discord(app)?\.com\/channels\/\d{15,21}\/\d{15,21}\/?$/i.test(url.replace(/^http:/i, "https:"))
    ? url.replace(/^http:/i, "https:").replace(/\/$/, "")
    : null;
}

// A channel webhook: https://discord.com/api/webhooks/<id>/<token>
function cleanWebhook(text) {
  const url = String(text || "").trim();
  if (!url) return "";
  return /^https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\/\d{15,21}\/[A-Za-z0-9_-]{30,100}\/?$/i.test(url)
    ? url.replace(/\/$/, "")
    : null;
}

// ---------- Posting to Discord ----------

function formatTime(t) {
  let [h, m] = String(t).split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
function whenText(group) {
  return `${group.days.map((d) => DAY_NAMES[d]).join(", ")} · ${formatTime(group.start)} – ${formatTime(group.end)}`;
}

function groupLink(group) {
  const base = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/group?id=${group.id}` : undefined;
}

// Send one message to a channel webhook. Mentions are switched off, so nothing typed in
// StudySync can ping @everyone. Returns true if Discord accepted it.
async function postToDiscord(webhookUrl, message) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "StudySync", allowed_mentions: { parse: [] }, ...message }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function spotMessage(group, place, setBy) {
  return {
    embeds: [{
      title: "📍 Meeting spot set",
      description: `**${place.replace(/[*_~`|>]/g, "")}**`,
      color: 0x2b4acb,
      url: groupLink(group),
      fields: [
        { name: "When", value: whenText(group), inline: true },
        { name: "Set by", value: setBy, inline: true },
      ],
      footer: { text: group.name },
    }],
  };
}

// ---------- Reading ----------

// The group's meetup, suggested spots and Discord links, for the group page
async function getInfo(db, group, userId) {
  const [meetup, spots, discord, classDiscord] = await Promise.all([
    db.from("group_meetup").select("place, set_by, set_at").eq("group_id", group.id).maybeSingle(),
    db.from("group_spots").select("id, user_id, place, created_at").eq("group_id", group.id).order("created_at"),
    db.from("group_discord").select("channel_url, webhook_url").eq("group_id", group.id).maybeSingle(),
    db.from("course_discord").select("invite_url").eq("course", group.course).maybeSingle(),
  ]);
  for (const result of [meetup, spots, discord, classDiscord]) if (result.error) throw result.error;

  const ids = spots.data.map((s) => s.id);
  let votes = [];
  if (ids.length) {
    const result = await db.from("group_spot_votes").select("spot_id, user_id").in("spot_id", ids);
    if (result.error) throw result.error;
    votes = result.data;
  }

  const names = new Map(group.members.map((m) => [m.userId, m.name]));
  const nameOf = (id) => (id === userId ? "You" : names.get(id) || "A former member");

  return {
    meetup: meetup.data
      ? { place: meetup.data.place, setBy: nameOf(meetup.data.set_by), setAt: meetup.data.set_at }
      : null,
    spots: spots.data
      .map((s) => {
        const voters = votes.filter((v) => v.spot_id === s.id);
        return {
          id: s.id,
          place: s.place,
          by: nameOf(s.user_id),
          isYours: s.user_id === userId,
          votes: voters.length,
          votedByYou: voters.some((v) => v.user_id === userId),
          isTheSpot: meetup.data?.place === s.place,
        };
      })
      .sort((a, b) => b.votes - a.votes),
    discord: {
      serverInvite: classDiscord.data?.invite_url || "",
      channelUrl: discord.data?.channel_url || "",
      connected: Boolean(discord.data?.webhook_url), // the webhook itself never goes to the browser
    },
  };
}

// ---------- Spots ----------

function cleanPlace(input) {
  const place = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (!place) return { error: "Type a place first." };
  if (place.length > MAX_PLACE) return { error: `Keep it under ${MAX_PLACE} characters.` };
  const problem = checkMessage(place);
  if (problem) return problem;
  return { value: place };
}

async function addSpot(db, group, userId, input) {
  const place = cleanPlace(input.place);
  if (place.error) return place;

  const { data: existing, error } = await db.from("group_spots").select("id, place").eq("group_id", group.id);
  if (error) throw error;
  if (existing.some((s) => s.place.toLowerCase() === place.value.toLowerCase())) {
    return { error: "Someone already suggested that. Vote for it instead." };
  }
  if (existing.length >= MAX_SPOTS) {
    return { error: `That's ${MAX_SPOTS} suggestions already. Remove one or vote for an existing spot.` };
  }

  const inserted = await db.from("group_spots").insert({ group_id: group.id, place: place.value }).select("id").single();
  if (inserted.error) throw inserted.error;
  // Suggesting a place counts as a vote for it
  const vote = await db.from("group_spot_votes").insert({ spot_id: inserted.data.id });
  if (vote.error) throw vote.error;
  return { value: true };
}

async function removeSpot(db, group, spotId) {
  const { error } = await db.from("group_spots").delete().eq("id", spotId).eq("group_id", group.id);
  if (error) throw error;
}

async function setVote(db, group, userId, spotId, on) {
  const { data: spot, error } = await db.from("group_spots").select("id").eq("id", spotId).eq("group_id", group.id).maybeSingle();
  if (error) throw error;
  if (!spot) return { error: "That suggestion was removed." };
  const result = on
    ? await db.from("group_spot_votes").upsert({ spot_id: spotId, user_id: userId }, { onConflict: "spot_id,user_id", ignoreDuplicates: true })
    : await db.from("group_spot_votes").delete().eq("spot_id", spotId).eq("user_id", userId);
  if (result.error) throw result.error;
  return { value: true };
}

// ---------- The meeting spot ----------

// Make a place the group's meeting spot, and tell the group's Discord channel.
// Returns { value: { posted } } or { error }.
async function setMeetup(db, group, userId, input) {
  const place = cleanPlace(input.place);
  if (place.error) return place;

  const { error } = await db.from("group_meetup")
    .upsert({ group_id: group.id, place: place.value, set_by: userId, set_at: new Date().toISOString() }, { onConflict: "group_id" });
  if (error) throw error;

  const discord = await db.from("group_discord").select("webhook_url").eq("group_id", group.id).maybeSingle();
  if (discord.error) throw discord.error;
  let posted = false;
  if (discord.data?.webhook_url) {
    const me = group.members.find((m) => m.userId === userId);
    posted = await postToDiscord(discord.data.webhook_url, spotMessage(group, place.value, me?.name || "A member"));
  }
  return { value: { posted, discordConnected: Boolean(discord.data?.webhook_url) } };
}

async function clearMeetup(db, group) {
  const { error } = await db.from("group_meetup").delete().eq("group_id", group.id);
  if (error) throw error;
}

// ---------- Discord links ----------

// Save any of: the class server invite, the group's channel link, the channel webhook.
// An empty value removes it. A new webhook gets a hello message first, to make sure it works.
async function saveDiscord(db, group, userId, input) {
  if (input.serverInvite !== undefined) {
    const invite = cleanInvite(input.serverInvite);
    if (invite === null) return { error: "That doesn't look like a Discord invite. It should look like discord.gg/abc123." };
    const result = invite
      ? await db.from("course_discord").upsert({ course: group.course, invite_url: invite, set_by: userId, updated_at: new Date().toISOString() }, { onConflict: "course" })
      : await db.from("course_discord").delete().eq("course", group.course);
    if (result.error) throw result.error;
  }

  const fields = {};
  if (input.channelUrl !== undefined) {
    const channel = cleanChannel(input.channelUrl);
    if (channel === null) return { error: "That doesn't look like a channel link. In Discord, right-click the channel → Copy Link." };
    fields.channel_url = channel || null;
  }
  if (input.webhookUrl !== undefined) {
    const webhook = cleanWebhook(input.webhookUrl);
    if (webhook === null) return { error: "That doesn't look like a Discord webhook link. It starts with https://discord.com/api/webhooks/." };
    if (webhook) {
      const ok = await postToDiscord(webhook, {
        content: `👋 StudySync is connected to this channel for **${group.name.replace(/[*_~`|>]/g, "")}**. ` +
          "When your group picks a meeting spot, it'll show up here.",
      });
      if (!ok) return { error: "Discord didn't accept that webhook. Check the link, or make a new webhook and try again." };
    }
    fields.webhook_url = webhook || null;
  }

  if (Object.keys(fields).length) {
    const { error } = await db.from("group_discord")
      .upsert({ group_id: group.id, ...fields, updated_at: new Date().toISOString() }, { onConflict: "group_id" });
    if (error) throw error;
  }
  return { value: true };
}

// The tables are new: true if this error means the database hasn't been updated yet
function isMissingTable(error) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" ||
    /group_spots|group_meetup|group_discord|course_discord|group_spot_votes/.test(error.message || "")));
}

module.exports = {
  getInfo, addSpot, removeSpot, setVote, setMeetup, clearMeetup, saveDiscord, isMissingTable,
  cleanInvite, cleanChannel, cleanWebhook, cleanPlace, MAX_SPOTS,
};
