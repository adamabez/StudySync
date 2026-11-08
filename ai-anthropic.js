// StudySync - the AI, Anthropic (Claude) version. ai.js decides whether this or
// ai-gemini.js is used; both take the same inputs and return the same shapes.
//
// Needs in .env:  ANTHROPIC_API_KEY=sk-ant-...

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-5-5";

let client;
function getClient() {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

function hasKey() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  return Boolean(key) && key !== "sk-ant-your-key-here"; // ignore the placeholder from .env.example
}

// Turn one saved source into a "document" block the AI can read and cite
function toDocument({ source, content }) {
  return {
    type: "document",
    source: source.type === "pdf"
      ? { type: "base64", media_type: "application/pdf", data: content }
      : { type: "text", media_type: "text/plain", data: content },
    title: source.title,
    citations: { enabled: true },
  };
}

function pageLabel(c) {
  if (c.type !== "page_location") return "";
  const last = c.end_page_number - 1; // end page is exclusive
  return last > c.start_page_number ? `pp. ${c.start_page_number}–${last}` : `p. ${c.start_page_number}`;
}

// sources: [{ source, content }]   history: [{ role, content }]   question: string
// Returns { answer, citations } on success or { error } if the AI couldn't answer.
async function askNotebook({ system, sources, history, question }) {
  const documents = sources.map(toDocument);
  // Cache the documents so follow-up questions about the same materials are cheaper and faster
  documents[documents.length - 1].cache_control = { type: "ephemeral" };

  // The documents ride along with the first question; later turns are plain text
  const turns = [...history, { role: "user", content: question }];
  const messages = turns.map((turn, i) =>
    i === 0
      ? { role: "user", content: [...documents, { type: "text", text: turn.content }] }
      : { role: turn.role, content: turn.content },
  );

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system,
    output_config: { effort: "medium" },
    // If the model declines, the API retries on a recommended fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages,
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    return { error: "The AI couldn't answer that one. Try rephrasing your question." };
  }

  // Stitch the answer together, putting a ⟦n⟧ marker wherever the AI cited a source
  let answer = "";
  const citations = [];
  const seen = new Map();

  for (const block of message.content) {
    if (block.type !== "text") continue;
    answer += block.text;

    const numbers = new Set();
    for (const c of block.citations ?? []) {
      const key = c.document_index + "|" + c.cited_text;
      if (!seen.has(key)) {
        seen.set(key, citations.length + 1);
        citations.push({
          n: citations.length + 1,
          source: sources[c.document_index]?.source.title ?? c.document_title ?? "Source",
          page: pageLabel(c),
          quote: c.cited_text.trim(),
        });
      }
      numbers.add(seen.get(key));
    }
    for (const n of numbers) answer += `⟦${n}⟧`;
  }

  if (message.stop_reason === "max_tokens") answer += "\n\n*(Answer cut off because it got too long. Ask for less at once.)*";
  return { answer: answer.trim(), citations };
}

// Returns [{ day, start, end, reason }] as the AI suggested them (not yet checked),
// or throws if the AI couldn't answer.
async function planStudyWeek({ system, schema, prompt }) {
  const message = await getClient().beta.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      system,
      // Planning a week is a small job, so keep thinking short and the answer fast
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: 45_000, maxRetries: 1 }, // the page falls back to the algorithm rather than wait forever
  );

  if (message.stop_reason === "refusal") throw new Error("The AI declined to plan this week.");
  if (message.stop_reason === "max_tokens") throw new Error("The AI's plan was cut off.");
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  return JSON.parse(text).sessions;
}

// Turn an API error into a message a student can act on (null if it isn't an Anthropic error)
function explainError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "The Anthropic API key in .env isn't valid. Check it and restart the server.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the AI. Check your Anthropic Console account.";
  if (error instanceof Anthropic.RateLimitError) return "The AI is busy right now. Wait a moment and try again.";
  if (error instanceof Anthropic.BadRequestError) return "The AI couldn't process those materials: " + error.message;
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI. Check your internet connection.";
  if (error instanceof Anthropic.APIError) return `The AI ran into a problem (error ${error.status}). Try again in a moment.`;
  return null;
}

module.exports = { name: "Anthropic", keyName: "ANTHROPIC_API_KEY", hasKey, askNotebook, planStudyWeek, explainError };
