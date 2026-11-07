// StudySync - saved Virtual Notebook chats.
// Stored in notebook-data/chats.json, so every chat is still there after a refresh or restart.
//
// Each chat looks like:
//   { id, title, createdAt, updatedAt, messages: [
//       { role: "user", label, question },          ← label = what the bubble shows, question = what Claude got
//       { role: "assistant", answer, citations },
//   ] }

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "notebook-data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MAX_TURNS_SENT = 20; // how many earlier questions + answers Claude sees as context

function loadChats() {
  try {
    return JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveChats(chats) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}

// The short version used for the chat dropdown
function summary(chat) {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, questions: chat.messages.length / 2 };
}

function listChats() {
  return loadChats().map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getChat(id) {
  return loadChats().find((c) => c.id === id) ?? null;
}

// The conversation so far, in the shape Claude expects (most recent turns only)
function historyFor(chat) {
  return chat.messages.slice(-MAX_TURNS_SENT * 2).map((m) =>
    m.role === "user"
      ? { role: "user", content: m.question }
      : { role: "assistant", content: m.answer.replace(/⟦\d+⟧/g, "") });
}

// Name a new chat after how it started ("Summarize", "What is ATP?"...)
function makeTitle(label) {
  const title = label.replace(/\s+/g, " ").trim();
  return title.length > 40 ? title.slice(0, 39).trimEnd() + "…" : title;
}

// Save one question + answer. Creates the chat if chatId is null. Returns the chat.
function addExchange(chatId, { label, question, answer, citations }) {
  const chats = loadChats();
  const now = new Date().toISOString();
  let chat = chatId ? chats.find((c) => c.id === chatId) : null;
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: makeTitle(label), createdAt: now, updatedAt: now, messages: [] };
    chats.push(chat);
  }
  chat.messages.push({ role: "user", label, question }, { role: "assistant", answer, citations });
  chat.updatedAt = now;
  saveChats(chats);
  return chat;
}

function deleteChat(id) {
  saveChats(loadChats().filter((c) => c.id !== id));
}

module.exports = { listChats, getChat, historyFor, addExchange, deleteChat, summary };
