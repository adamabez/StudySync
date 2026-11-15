// StudySync - profiles: a photo, major, year and classes, each shared with your study groups or
// kept to yourself (supabase/profiles.sql). `db` is the logged-in student's client, so the
// database rules decide what they can see: their own profile, and the parts classmates in
// their study groups chose to share. Nobody else's.
//
// The browser never sees user IDs: each profile has a random profileId, used in
// /api/members/<profileId> (someone's card) and /api/photos/<profileId> (their photo).
// Photos are small squares (the browser shrinks them to 256 × 256 first) in the private
// "avatars" bucket at <profileId>/photo.

const { checkMessage } = require("./namefilter");
const { addFeedback } = require("./feedback");

const BUCKET = "avatars";
const YEARS = ["freshman", "sophomore", "junior", "senior", "grad"];
const MAX_MAJOR = 60;
const MAX_PHOTO_BYTES = 256 * 1024;
const COLUMNS = "profile_id, major, class_year, photo_updated_at, share_photo, share_major, share_year, share_classes";

// supabase/profiles.sql hasn't been run yet: no such column / function / bucket
function isNotSetUp(error) {
  return ["42703", "PGRST204", "PGRST202", "42883"].includes(error?.code) ||
    /profile_id|share_photo|member_profile|avatars|Bucket not found/i.test(error?.message || "");
}

const photoVersion = (timestamp) => (timestamp ? Math.floor(new Date(timestamp).getTime() / 1000) : null);
const photoUrl = (profileId, version) => (profileId && version ? `/api/photos/${profileId}?v=${version}` : null);

// The student's own profile row, made if they don't have one yet (it gets a profileId then)
async function ownRow(db, userId) {
  let { data, error } = await db.from("profiles").select(COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data || !data.profile_id) {
    const made = await db.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id" }).select(COLUMNS).single();
    if (made.error) throw made.error;
    data = made.data;
  }
  return data;
}

// Class names on their schedule (classes only, not tasks or other items), A-Z
async function myClassNames(db) {
  const { data, error } = await db.from("classes").select("name").eq("kind", "class");
  if (error) throw error;
  return [...new Set((data || []).map((c) => c.name))].sort((a, b) => a.localeCompare(b));
}

// For Account settings: everything, plus what's shared.
// { setUp, profileId, major, year, photoUrl, classes, share: { photo, major, year, classes } }
async function getMyProfile(db, userId) {
  let row;
  try {
    row = await ownRow(db, userId);
  } catch (error) {
    if (isNotSetUp(error)) return { setUp: false };
    throw error;
  }
  return {
    setUp: true,
    profileId: row.profile_id,
    major: row.major || "",
    year: row.class_year || "",
    photoUrl: photoUrl(row.profile_id, photoVersion(row.photo_updated_at)),
    classes: await myClassNames(db),
    share: { photo: row.share_photo, major: row.share_major, year: row.share_year, classes: row.share_classes },
  };
}

// Save major, year and what's shared (send any of them). Returns the fresh profile, or { error }.
async function updateMyProfile(db, userId, input) {
  const fields = {};
  if (input.major !== undefined) {
    const major = typeof input.major === "string" ? input.major.replace(/\s+/g, " ").trim() : "";
    if (major.length > MAX_MAJOR) return { error: `Keep your major under ${MAX_MAJOR} characters.` };
    if (major && checkMessage(major)) return { error: "Please keep your major appropriate." };
    fields.major = major || null;
  }
  if (input.year !== undefined) {
    if (input.year && !YEARS.includes(input.year)) return { error: "Pick your year from the list." };
    fields.class_year = input.year || null;
  }
  if (input.share && typeof input.share === "object") {
    for (const part of ["major", "year", "classes"]) { // a photo always shows to your groups
      if (typeof input.share[part] === "boolean") fields["share_" + part] = input.share[part];
    }
  }
  if (!Object.keys(fields).length) return { error: "Nothing to save." };
  await ownRow(db, userId); // makes sure there's a row (and profileId) to update
  const { error } = await db.from("profiles").update(fields).eq("user_id", userId);
  if (error) throw error;
  return { value: await getMyProfile(db, userId) };
}

// A photo from the browser: "data:image/webp;base64,..." (or jpeg), already shrunk to a small
// square. Checks it really is a WebP / JPEG and small, then stores it. Returns { value } or { error }.
async function savePhoto(db, userId, dataUrl) {
  const match = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === "string" ? dataUrl : "");
  if (!match) return { error: "That photo didn't come through. Try a different picture." };
  const bytes = Buffer.from(match[2], "base64");
  const isWebp = bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!(match[1] === "image/webp" ? isWebp : isJpeg)) return { error: "That photo didn't come through. Try a different picture." };
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "That photo is too big. Try a different picture." };

  const row = await ownRow(db, userId);
  const upload = await db.storage.from(BUCKET).upload(`${row.profile_id}/photo`, bytes, { contentType: match[1], upsert: true });
  if (upload.error) throw upload.error;
  // A photo always shows to your study groups (share_photo stays on)
  const { error } = await db.from("profiles").update({ photo_updated_at: new Date().toISOString(), share_photo: true }).eq("user_id", userId);
  if (error) throw error;
  return { value: await getMyProfile(db, userId) };
}

// Remove their photo (also used when deleting the account). Returns the fresh profile.
async function removePhoto(db, userId) {
  const row = await ownRow(db, userId);
  const removed = await db.storage.from(BUCKET).remove([`${row.profile_id}/photo`]);
  if (removed.error && !isNotSetUp(removed.error)) throw removed.error;
  const { error } = await db.from("profiles").update({ photo_updated_at: null }).eq("user_id", userId);
  if (error) throw error;
  return getMyProfile(db, userId);
}

// Someone's card: { profileId, name, isYou, photoUrl, major, year, classes } with only what
// you may see (null for hidden parts), or null if you don't share a study group with them.
async function memberProfile(db, profileId) {
  const { data, error } = await db.rpc("member_profile", { pid: profileId });
  if (error) {
    if (isNotSetUp(error)) return null;
    throw error;
  }
  if (!data) return null;
  const { photo, ...card } = data;
  return { ...card, photoUrl: photoUrl(card.profileId, photo) };
}

// Their photo's bytes, if you may see it (the storage rules check): { bytes, type } or null
async function photoFile(db, profileId) {
  const { data, error } = await db.storage.from(BUCKET).download(`${profileId}/photo`);
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), type: data.type || "image/webp" };
}

// "Report photo" on a classmate's card. Goes to the feedback table, which the team reads in
// Supabase (Table Editor → feedback). To take a photo down: Storage → avatars → delete the
// <profileId> folder, and clear photo_updated_at for that profile_id in the profiles table.
async function reportPhoto(db, profileId, reason, userAgent, email) {
  const card = await memberProfile(db, profileId);
  if (!card || card.isYou || !card.photoUrl) return { error: "That photo isn't there anymore." };
  const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  return addFeedback(db, {
    kind: "bug",
    message: `PHOTO REPORT: profile_id ${profileId} (${card.name}).${why ? " Reason: " + why : ""}\n` +
      `To remove: Storage → avatars → ${profileId}/photo, then set photo_updated_at to null for that profile_id.`,
    page: "/group",
  }, userAgent, email);
}

module.exports = {
  YEARS, isNotSetUp, photoVersion, photoUrl,
  getMyProfile, updateMyProfile, savePhoto, removePhoto, memberProfile, photoFile, reportPhoto,
};
