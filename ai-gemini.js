// StudySync - the AI, Google Gemini version (free tier, good for demos). ai.js decides
// whether this or ai-anthropic.js is used; both take the same inputs and return the same shapes.
//
// Needs in .env:  GEMINI_API_KEY=...   (free key from https://aistudio.google.com/apikey)
// Optional:       GEMINI_MODEL=...           (default: gemini-3.5-flash)
//                 GEMINI_FALLBACK_MODEL=...  (default: gemini-3.5-flash-lite; used when the main
//                                             model is overloaded or too slow, which happens on
//                                             the free tier)
//
// Heads up: on Google's free tier, prompts can be used to improve Google's products.
// Fine for a demo with test data; tell students before they upload real notes.
//
// Claude cites sources by itself. Gemini doesn't, so here the AI returns JSON with [n]
// markers and the exact quotes it used, and quotes from text sources are checked
// against the source before they're shown.

const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_FALLBACK = "gemini-3.5-flash-lite";

const model = () => (process.env.GEMINI_MODEL || "").trim() || DEFAULT_MODEL;
const fallbackModel = () => (process.env.GEMINI_FALLBACK_MODEL || "").trim() || DEFAULT_FALLBACK;

// Worth trying the fallback model: overloaded (503), out of quota for this model (429), or too slow
const shouldFallBack = (error) => error.status === 503 || error.status === 429 || error.message === "timeout";

function hasKey() {
  const key = process.env.GEMINI_API_KEY || "";
  return Boolean(key) && key !== "your-gemini-key-here"; // ignore the placeholder from .env.example
}

class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Gemini's schema format: OpenAPI-style types in capitals, no additionalProperties
function toGeminiSchema(schema) {
  const out = {};
  if (schema.type) out.type = schema.type.toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  return out;
}

// Ask Gemini, switching to the fallback model if the main one is overloaded or too slow.
// timeoutMs is split between the two tries. Returns { text, finishReason }.
async function generate({ system, contents, schema, timeoutMs }) {
  const models = [...new Set([model(), fallbackModel()])];
  const perTry = Math.floor(timeoutMs / models.length);
  for (let i = 0; i < models.length; i++) {
    try {
      return await generateWith(models[i], { system, contents, schema, timeoutMs: perTry });
    } catch (error) {
      if (i === models.length - 1 || !(error instanceof GeminiError) || !shouldFallBack(error)) throw error;
      console.error(`Gemini ${models[i]} unavailable (${error.status || error.message}), trying ${models[i + 1]}`);
    }
  }
}

// One call to one Gemini model
async function generateWith(modelName, { system, contents, schema, timeoutMs }) {
  let response;
  try {
    response = await fetch(API + encodeURIComponent(modelName) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          maxOutputTokens: 16000,
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(schema),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new GeminiError(0, error.name === "TimeoutError" ? "timeout" : error.message);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GeminiError(response.status, data.error?.message || response.statusText);

  if (data.promptFeedback?.blockReason) return { text: "", finishReason: "BLOCKED" };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  return { text, finishReason: candidate?.finishReason || "STOP" };
}

// ---------- Virtual Notebook ----------

const CITE_INSTRUCTIONS = `

Each source is numbered (Source 1, Source 2, ...). Reply as JSON:
- "answer": your answer in Markdown. Right after each statement that comes from the materials, put a citation marker like [1]. Number citations 1, 2, 3... in the order you first use them, and reuse a number when you cite the same passage again. Don't put markers on general explanations that aren't from the materials.
- "citations": one entry per citation number, with "n" (the number), "source" (the source number), "quote" (a short passage under 300 characters, copied word for word from that source), and "page" (the page number for PDF sources if you know it, otherwise 0).`;

const NOTEBOOK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          source: { type: "integer" },
          quote: { type: "string" },
          page: { type: "integer" },
        },
        required: ["n", "source", "quote"],
      },
    },
  },
  required: ["answer", "citations"],
};

// Each source becomes a label + its content (PDFs are read by Gemini directly)
function sourceParts(sources) {
  return sources.flatMap(({ source, content }, i) => {
    const label = `Source ${i + 1}: "${source.title}"${source.course ? ` (${source.course})` : ""}`;
    return source.type === "pdf"
      ? [{ text: label + " (PDF, attached next)" }, { inline_data: { mime_type: "application/pdf", data: content } }]
      : [{ text: `${label}\n<source>\n${content}\n</source>` }];
  });
}

const squash = (s) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// Keep the citations that point at a real source (and, for text sources, quote it for
// real), number them in the order they appear, and turn [n] markers into ⟦n⟧.
function finishCitations(answer, rawCitations, sources) {
  const valid = new Map(); // the AI's number → citation
  for (const c of Array.isArray(rawCitations) ? rawCitations : []) {
    const entry = sources[Number(c.source) - 1];
    const quote = typeof c.quote === "string" ? c.quote.trim() : "";
    if (!entry || !quote || valid.has(Number(c.n))) continue;
    if (entry.source.type !== "pdf" && !squash(entry.content).includes(squash(quote))) continue; // made-up quote
    const page = Number(c.page) > 0 ? `p. ${Number(c.page)}` : "";
    valid.set(Number(c.n), { source: entry.source.title, page, quote: quote.slice(0, 500) });
  }

  const citations = [];
  const renumber = new Map();
  const text = answer.replace(/ ?\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, list) => {
    const numbers = list.split(",").map((n) => Number(n.trim()));
    if (!numbers.some((n) => valid.has(n))) return /^\s*\d+\s*$/.test(list) ? "" : match; // drop unbacked markers
    return numbers.filter((n) => valid.has(n)).map((n) => {
      if (!renumber.has(n)) {
        renumber.set(n, citations.length + 1);
        citations.push({ n: citations.length + 1, ...valid.get(n) });
      }
      return `⟦${renumber.get(n)}⟧`;
    }).join("");
  });
  return { answer: text.trim(), citations };
}

// sources: [{ source, content }]   history: [{ role, content }]   question: string
// Returns { answer, citations } on success or { error } if the AI couldn't answer.
async function askNotebook({ system, sources, history, question }) {
  const turns = [...history, { role: "user", content: question }];
  const contents = turns.map((turn, i) => ({
    role: turn.role === "assistant" ? "model" : "user",
    // The sources ride along with the first question; later turns are plain text
    parts: i === 0 ? [...sourceParts(sources), { text: turn.content }] : [{ text: turn.content }],
  }));

  const { text, finishReason } = await generate({ system: system + CITE_INSTRUCTIONS, contents, schema: NOTEBOOK_SCHEMA, timeoutMs: 120_000 });

  if (finishReason === "MAX_TOKENS") return { error: "The answer got too long. Ask for less at once." };
  if (!text) return { error: "The AI couldn't answer that one. Try rephrasing your question." };

  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    return { answer: text.trim(), citations: [] }; // not JSON after all: show it without citations
  }
  if (typeof reply.answer !== "string" || !reply.answer.trim()) {
    return { error: "The AI couldn't answer that one. Try rephrasing your question." };
  }
  return finishCitations(reply.answer, reply.citations, sources);
}

// ---------- Study planner ----------

// Returns [{ day, start, end, reason }] as the AI suggested them (not yet checked),
// or throws if the AI couldn't answer.
async function planStudyWeek({ system, schema, prompt }) {
  const { text, finishReason } = await generate({
    system,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    schema,
    timeoutMs: 45_000, // the page falls back to the algorithm rather than wait forever
  });
  if (finishReason === "MAX_TOKENS") throw new Error("The AI's plan was cut off.");
  if (!text) throw new Error("The AI declined to plan this week (" + finishReason + ").");
  return JSON.parse(text).sessions;
}

// Turn an API error into a message a student can act on (null if it isn't a Gemini error)
function explainError(error) {
  if (!(error instanceof GeminiError)) return null;
  const { status, message } = error;
  if (status === 0) return message === "timeout" ? "The AI took too long to answer. Try again with fewer sources." : "Couldn't reach the AI. Check your internet connection.";
  if (/API key not valid|API_KEY_INVALID/i.test(message) || status === 401) return "The Gemini API key in .env isn't valid. Check it and restart the server.";
  if (status === 403) return "This Gemini API key isn't allowed to use the AI. Check it in Google AI Studio.";
  if (status === 404) return `The Gemini model "${model()}" wasn't found. Set GEMINI_MODEL in .env to a current model and restart.`;
  if (status === 429) return "The free AI limit was reached for now. Wait a minute and try again.";
  if (status === 503) return "The AI is very busy right now. Wait a minute and try again.";
  if (status === 400) return "The AI couldn't process those materials: " + message;
  return `The AI ran into a problem (error ${status}). Try again in a moment.`;
}

module.exports = { name: "Gemini", keyName: "GEMINI_API_KEY", hasKey, askNotebook, planStudyWeek, explainError, finishCitations };
