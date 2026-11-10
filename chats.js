// StudySync - saved Virtual Notebook chats.
// Stored in the Supabase "chats" table (see supabase/schema.sql), so every chat
// is still there after a refresh, a restart, or logging in on another computer.
//
// Each chat looks like:
//   { id, title, createdAt, updatedAt, messages: [
//       { role: "user", label, question },          ← label = what the bubble shows, question = what the AI got
//       { role: "assistant", answer, citations },
//   ] }
//
// Every function that touches the database takes `db` first: the Supabase client
// for the logged-in user, from auth.supabaseFor(req). Row Level Security means
// each user only ever sees and changes their own chats.

const MAX_TURNS_SENT = 20; // how many earlier questions + answers the AI sees as context

function fromRow(row) {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, messages: row.messages };
}

// The short version used for the chat dropdown
function summary(chat) {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, questions: chat.messages.length / 2 };
}

async function listChats(db) {
  const { data, error } = await db.from("chats").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map(fromRow).map(summary);
}

async function getChat(db, id) {
  const { data, error } = await db.from("chats").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

// The conversation so far, in the shape the AI expects (most recent turns only)
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

// Save one question + answer. Creates the chat if `chat` is null. Returns the saved chat.
async function addExchange(db, chat, { label, question, answer, citations }) {
  const exchange = [{ role: "user", label, question }, { role: "assistant", answer, citations }];
  const now = new Date().toISOString();

  const query = chat
    ? db.from("chats").update({ messages: [...chat.messages, ...exchange], updated_at: now }).eq("id", chat.id)
    : db.from("chats").insert({ title: makeTitle(label), messages: exchange, created_at: now, updated_at: now });

  const { data, error } = await query.select().single();
  if (error) throw error;
  return fromRow(data);
}

async function deleteChat(db, id) {
  const { error } = await db.from("chats").delete().eq("id", id);
  if (error) throw error;
}

module.exports = { listChats, getChat, historyFor, addExchange, deleteChat, summary, makeTitle };
