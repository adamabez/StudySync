// StudySync - API: the study assistant (Virtual Notebook): course materials
// (lib/materials.js), saved chats (lib/chats.js) and asking the AI (lib/ai.js).

const ai = require("../lib/ai");
const materials = require("../lib/materials");
const chats = require("../lib/chats");
const { sendJson, readJson } = require("../lib/http");

module.exports = [
  // --- Course materials ---
  ["GET", "/api/sources", async ({ res, db }) => {
    sendJson(res, (await materials.listSources(db)).map(materials.forBrowser));
  }],

  ["POST", "/api/sources", ({ req, res, db, userId }) => readJson(req, res, 7_500_000, async (input) => { // room for a 5 MB PDF (base64 is a third bigger)
    const result = await materials.addSource(db, userId, input);
    if (result.error) return sendJson(res, { error: result.error }, 400);
    sendJson(res, result.value, 201);
  })],

  // Viewing a material: its details, plus the text for typed or pasted notes
  ["GET", "/api/sources/:id", async ({ res, db, params }) => {
    const source = await materials.getSource(db, params.id);
    if (!source) return sendJson(res, { error: "That material was removed. Refresh the page." }, 404);
    const text = source.type === "text" ? await materials.readContent(db, source) : null;
    sendJson(res, { ...materials.forBrowser(source), text });
  }],

  // The PDF itself, shown in the browser's PDF viewer
  ["GET", "/api/sources/:id/file", async ({ res, db, params }) => {
    const source = await materials.getSource(db, params.id);
    if (!source || source.type !== "pdf") return sendJson(res, { error: "PDF not found" }, 404);
    const pdf = await materials.readPdf(db, source);
    const filename = source.title.replace(/[^\w .()-]+/g, "").trim() || "material";
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    });
    res.end(pdf);
  }],

  ["DELETE", "/api/sources/:id", async ({ res, db, params }) => {
    await materials.removeSource(db, params.id);
    sendJson(res, { ok: true });
  }],

  // --- Saved chats ---
  ["GET", "/api/chats", async ({ res, db }) => sendJson(res, await chats.listChats(db))],

  ["GET", "/api/chats/:id", async ({ res, db, params }) => {
    const chat = await chats.getChat(db, params.id);
    chat ? sendJson(res, chat) : sendJson(res, { error: "Chat not found" }, 404);
  }],

  ["DELETE", "/api/chats/:id", async ({ res, db, params }) => {
    await chats.deleteChat(db, params.id);
    sendJson(res, { ok: true });
  }],

  // --- Asking the AI ---
  ["GET", "/api/notebook/status", ({ res }) => {
    sendJson(res, { aiEnabled: ai.aiEnabled(), freeTier: ai.aiEnabled() && ai.providerInfo().freeTier });
  }],

  ["POST", "/api/notebook/ask", ({ req, res, db }) => readJson(req, res, 2_000_000, async (input) => {
    if (!ai.aiEnabled()) return sendJson(res, { error: `AI answers are off. Add ${ai.providerInfo().keyName} to .env and restart the server.` }, 503);

    const question = typeof input.question === "string" ? input.question.trim() : "";
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 200) : question;
    const ids = Array.isArray(input.sourceIds) ? input.sourceIds : [];
    if (!question || question.length > 5_000) return sendJson(res, { error: "Type a question (5,000 characters max)." }, 400);

    // Continue an existing chat, or start a new one when there's no chatId
    const isChatId = typeof input.chatId === "string" && /^[\w-]+$/.test(input.chatId);
    const chat = isChatId ? await chats.getChat(db, input.chatId) : null;
    if (input.chatId && !chat) return sendJson(res, { error: "That chat was deleted. Start a new chat." }, 404);
    const history = chat ? chats.historyFor(chat) : [];

    const selected = (await materials.listSources(db)).filter((s) => ids.includes(s.id));
    if (selected.length === 0) return sendJson(res, { error: "Tick at least one source to ask about." }, 400);

    const sources = await Promise.all(selected.map(async (source) => ({ source: materials.forBrowser(source), content: await materials.readContent(db, source) })));
    const totalSize = sources.reduce((sum, s) => sum + s.content.length, 0);
    if (totalSize > 25_000_000) return sendJson(res, { error: "That's too much material at once. Untick a few sources." }, 400);

    let result;
    try {
      result = await ai.askNotebook({ sources, history, question });
    } catch (error) {
      console.error("Notebook question failed:", error);
      return sendJson(res, { error: ai.explainError(error) }, 502);
    }
    if (result.error) return sendJson(res, { error: result.error }, 422);
    const saved = await chats.addExchange(db, chat, { label, question, ...result });
    sendJson(res, { ...result, chat: chats.summary(saved) });
  })],
];
