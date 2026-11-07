// StudySync - saving and loading course materials for the Virtual Notebook.
// Everything is stored in the notebook-data/ folder (created automatically):
//   notebook-data/sources.json   → the list of materials (title, course, type...)
//   notebook-data/<id>.txt|.pdf  → the actual content of each one

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "notebook-data");
const INDEX_FILE = path.join(DATA_DIR, "sources.json");

const MAX_TEXT_CHARS = 500_000;          // about 250 pages of notes
const MAX_PDF_BYTES = 10 * 1024 * 1024;  // 10 MB per PDF

function listSources() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return []; // nothing added yet
  }
}

function saveIndex(sources) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(sources, null, 2));
}

function contentPath(source) {
  return path.join(DATA_DIR, source.id + (source.type === "pdf" ? ".pdf" : ".txt"));
}

// Check and save a new piece of material. Returns { value } or { error }.
function addSource(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const course = typeof input.course === "string" ? input.course.trim() : "";
  if (!title || title.length > 120) return { error: "Give the material a title (120 characters max)." };
  if (course.length > 60) return { error: "Course name is 60 characters max." };

  const id = crypto.randomUUID();
  let size;

  if (input.type === "text") {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) return { error: "The material is empty." };
    if (text.length > MAX_TEXT_CHARS) return { error: "That's too much text for one source. Split it into smaller parts." };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, id + ".txt"), text);
    size = text.length;
  } else if (input.type === "pdf") {
    const pdf = typeof input.data === "string" ? Buffer.from(input.data, "base64") : Buffer.alloc(0);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") return { error: "That file doesn't look like a PDF." };
    if (pdf.length > MAX_PDF_BYTES) return { error: "PDFs can be 10 MB max." };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, id + ".pdf"), pdf);
    size = pdf.length;
  } else {
    return { error: "Unknown material type." };
  }

  const source = { id, title, course, type: input.type, size, addedAt: new Date().toISOString() };
  saveIndex([...listSources(), source]);
  return { value: source };
}

function removeSource(id) {
  const sources = listSources();
  const source = sources.find((s) => s.id === id);
  if (!source) return;
  fs.rmSync(contentPath(source), { force: true });
  saveIndex(sources.filter((s) => s.id !== id));
}

// Text sources come back as text; PDFs come back as base64 (what Claude expects)
function readContent(source) {
  const data = fs.readFileSync(contentPath(source));
  return source.type === "pdf" ? data.toString("base64") : data.toString("utf8");
}

module.exports = { listSources, addSource, removeSource, readContent };
