// StudySync - saving and loading course materials for the Virtual Notebook.
// Stored in Supabase (see supabase/schema.sql):
//   "sources" table          → the list of materials (title, course, type...) + pasted text
//   "sources" Storage bucket → PDFs, at <user_id>/<source id>.pdf
//
// Every function takes `db` first: the Supabase client for the logged-in user,
// from auth.supabaseFor(req). Row Level Security means each user only ever
// sees and changes their own materials.

const crypto = require("crypto");

const BUCKET = "sources";
const MAX_TEXT_CHARS = 500_000;          // about 250 pages of notes
const MAX_PDF_BYTES = 10 * 1024 * 1024;  // 10 MB per PDF

// The columns the browser needs (leaves out the text itself, which can be big)
const LIST_COLUMNS = "id, user_id, title, course, type, size, added_at";

function fromRow(row) {
  return { id: row.id, userId: row.user_id, title: row.title, course: row.course, type: row.type, size: row.size, addedAt: row.added_at };
}

// What the browser gets: everything except userId
function forBrowser({ userId, ...source }) {
  return source;
}

function pdfPath(source) {
  return `${source.userId}/${source.id}.pdf`;
}

async function listSources(db) {
  const { data, error } = await db.from("sources").select(LIST_COLUMNS).order("added_at");
  if (error) throw error;
  return data.map(fromRow);
}

// Check and save a new piece of material. `userId` names the user's PDF folder.
// Returns { value } or { error }.
async function addSource(db, userId, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const course = typeof input.course === "string" ? input.course.trim() : "";
  if (!title || title.length > 120) return { error: "Give the material a title (120 characters max)." };
  if (course.length > 60) return { error: "Course name is 60 characters max." };

  const row = { id: crypto.randomUUID(), title, course, type: input.type };

  if (input.type === "text") {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) return { error: "The material is empty." };
    if (text.length > MAX_TEXT_CHARS) return { error: "That's too much text for one source. Split it into smaller parts." };
    row.text_content = text;
    row.size = text.length;
  } else if (input.type === "pdf") {
    const pdf = typeof input.data === "string" ? Buffer.from(input.data, "base64") : Buffer.alloc(0);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") return { error: "That file doesn't look like a PDF." };
    if (pdf.length > MAX_PDF_BYTES) return { error: "PDFs can be 10 MB max." };
    const upload = await db.storage.from(BUCKET).upload(`${userId}/${row.id}.pdf`, pdf, { contentType: "application/pdf" });
    if (upload.error) throw upload.error;
    row.size = pdf.length;
  } else {
    return { error: "Unknown material type." };
  }

  const { data, error } = await db.from("sources").insert(row).select(LIST_COLUMNS).single();
  if (error) {
    if (row.type === "pdf") await db.storage.from(BUCKET).remove([`${userId}/${row.id}.pdf`]); // don't leave an orphan file
    throw error;
  }
  return { value: forBrowser(fromRow(data)) };
}

async function removeSource(db, id) {
  const { data, error } = await db.from("sources").delete().eq("id", id).select(LIST_COLUMNS);
  if (error) throw error;
  for (const source of data.map(fromRow)) {
    if (source.type === "pdf") await db.storage.from(BUCKET).remove([pdfPath(source)]);
  }
}

// Text sources come back as text; PDFs come back as base64 (what Claude expects)
async function readContent(db, source) {
  if (source.type === "pdf") {
    const { data, error } = await db.storage.from(BUCKET).download(pdfPath(source));
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer()).toString("base64");
  }
  const { data, error } = await db.from("sources").select("text_content").eq("id", source.id).single();
  if (error) throw error;
  return data.text_content;
}

module.exports = { listSources, addSource, removeSource, readContent, forBrowser };
