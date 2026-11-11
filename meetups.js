// StudySync - getting a study group from "matched" to "meeting" without messaging anyone.
//
//   Spots     Members suggest places and vote. Anyone can make one "the spot".
//   RSVPs     Going / Running late / Can't make it, for each weekly session.
//   Moving    Can't make it? StudySync finds times this week when every member is free
//             (group_free_slots in the database), and one tap moves that week's session.
//
// A session is named by the date it would normally happen (sessionDate, "YYYY-MM-DD"), even
// when it's moved. The browser works out which date is next, since it knows the local time.
//
// Tables, rules and functions: the "Meeting up" part of supabase/schema.sql.
// Every function takes `db` first: the Supabase client for the logged-in user.

const { checkMessage } = require("./namefilter");

const MAX_PLACE = 120;
const MAX_SPOTS = 8; // suggestions per group, so the list stays short
const STATUSES = ["going", "late", "cant"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// "YYYY-MM-DD" a number of days from today (UTC; a day of slack either way covers time zones)
function dayOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDate(text) {
  return typeof text === "string" && DATE.test(text) && !isNaN(Date.parse(text + "T00:00:00Z"));
}

// ---------- Reading ----------

// Everything the group page shows about meeting up
async function getInfo(db, group, userId) {
  const since = dayOffset(-8); // last week's session can still be "upcoming" if it was moved later
  const [meetup, spots, rsvps, moves] = await Promise.all([
    db.from("group_meetup").select("place, set_by, set_at").eq("group_id", group.id).maybeSingle(),
    db.from("group_spots").select("id, user_id, place, created_at").eq("group_id", group.id).order("created_at"),
    db.from("group_rsvps").select("user_id, session_date, status").eq("group_id", group.id).gte("session_date", since),
    db.from("group_session_moves").select("session_date, new_date, new_start, new_end, moved_by").eq("group_id", group.id).gte("session_date", since),
  ]);
  for (const result of [meetup, spots, rsvps, moves]) if (result.error) throw result.error;

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
    // Members (in the order they joined) with their answer for each session
    rsvps: rsvps.data
      .filter((r) => names.has(r.user_id))
      .map((r) => ({ sessionDate: r.session_date, name: names.get(r.user_id), isYou: r.user_id === userId, status: r.status })),
    moves: moves.data.map((m) => ({
      sessionDate: m.session_date,
      date: m.new_date,
      start: m.new_start,
      end: m.new_end,
      movedBy: nameOf(m.moved_by),
    })),
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

async function setMeetup(db, group, userId, input) {
  const place = cleanPlace(input.place);
  if (place.error) return place;
  const { error } = await db.from("group_meetup")
    .upsert({ group_id: group.id, place: place.value, set_by: userId, set_at: new Date().toISOString() }, { onConflict: "group_id" });
  if (error) throw error;
  return { value: true };
}

async function clearMeetup(db, group) {
  const { error } = await db.from("group_meetup").delete().eq("group_id", group.id);
  if (error) throw error;
}

// ---------- RSVPs ----------

// { sessionDate, status }: status "going" | "late" | "cant", or null to take the answer back
async function setRsvp(db, group, userId, input) {
  if (!isDate(input.sessionDate) || input.sessionDate < dayOffset(-8) || input.sessionDate > dayOffset(15)) {
    return { error: "That session isn't coming up." };
  }
  if (input.status === null) {
    const { error } = await db.from("group_rsvps").delete()
      .eq("group_id", group.id).eq("user_id", userId).eq("session_date", input.sessionDate);
    if (error) throw error;
    return { value: true };
  }
  if (!STATUSES.includes(input.status)) return { error: "Pick Going, Running late or Can't make it." };
  const { error } = await db.from("group_rsvps").upsert(
    { group_id: group.id, user_id: userId, session_date: input.sessionDate, status: input.status, updated_at: new Date().toISOString() },
    { onConflict: "group_id,user_id,session_date" },
  );
  if (error) throw error;
  return { value: true };
}

// ---------- Moving one week's session ----------

// Weekly times every member is free for a session as long as the usual one:
// [{ day: "thu", start: "15:00", end: "16:30" }]. The browser turns them into dates.
async function freeSlots(db, group) {
  const { data, error } = await db.rpc("group_free_slots", { gid: group.id });
  if (error) throw error;
  return data.map((row) => ({ day: row.day_key, start: row.start_time, end: row.end_time }));
}

// { sessionDate, date, start, end }: move that week's session. The database checks again
// that everyone is free, then clears the session's RSVPs and marks you as going.
async function moveSession(db, group, input) {
  if (!isDate(input.sessionDate) || !isDate(input.date) || !TIME.test(input.start || "") || !TIME.test(input.end || "")) {
    return { error: "Pick one of the suggested times." };
  }
  const { error } = await db.rpc("move_group_session", {
    gid: group.id, p_session: input.sessionDate, p_new: input.date, p_start: input.start, p_end: input.end,
  });
  if (error) {
    if (/Not everyone is free/.test(error.message || "")) return { error: "Someone's schedule changed and that time doesn't work anymore. Pick another." };
    if (/too far away/.test(error.message || "")) return { error: "You can only move a session within the next week or so." };
    throw error;
  }
  return { value: true };
}

// Put a moved session back at its usual time
async function undoMove(db, group, input) {
  if (!isDate(input.sessionDate)) return { error: "That session isn't coming up." };
  const { error } = await db.from("group_session_moves").delete().eq("group_id", group.id).eq("session_date", input.sessionDate);
  if (error) throw error;
  return { value: true };
}

// The tables are new: true if this error means the database hasn't been updated yet
function isMissingTable(error) {
  if (!error) return false;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)) return true; // no such table / function
  return /does not exist|could not find/i.test(error.message || "") &&
    /group_spots|group_meetup|group_spot_votes|group_rsvps|group_session_moves|group_free_slots|move_group_session/.test(error.message || "");
}

module.exports = {
  getInfo, addSpot, removeSpot, setVote, setMeetup, clearMeetup,
  setRsvp, freeSlots, moveSession, undoMove, isMissingTable,
  cleanPlace, MAX_SPOTS, STATUSES,
};
