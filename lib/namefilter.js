// StudySync - keeps account names (what study group members see) appropriate.
// Used by onboarding.cleanName for sign-up and for name changes in Account settings.
//
// How it decides:
//   1. Only letters (any language), spaces, hyphens, apostrophes and periods are allowed.
//      That alone stops links, emails, emoji and l33t-speak like "f4ck".
//   2. SEVERE words are blocked anywhere inside a word ("xfuckx"), including when spaced
//      out ("f u c k") or stretched ("fuuuck").
//   3. WHOLE_WORDS are blocked only as a complete word, because they're also parts of real
//      names: "ass" in Cassandra, "dick" in Benedict, "shit" in Yamashita, "porn" in
//      Pornthip, "cock" in Hancock, "fuk" in Fukuda, "butt" (a common surname) not at all.
//   4. RESERVED words would let someone pass as staff ("Admin", "StudySync Support").
//
// No filter is perfect. If a real name is blocked, add an exception to ALLOWED; if
// something gets through, add it to the right list. The lists below are offensive on
// purpose: they're what gets blocked.

const SEVERE = [
  "fuck", "fck", "cunt", "nigger", "nigga", "faggot", "fagot", "whore", "bitch",
  "bastard", "retard", "pussy", "penis", "vagina", "dildo", "jizz", "wetback", "tranny",
  "hitler", "pedophile", "paedophile", "molester", "asshole", "arsehole", "dumbass",
  "jackass", "bullshit", "dipshit", "shithead", "shitface", "motherf", "cocksucker",
  "blowjob", "handjob", "masturbat", "orgasm", "ejaculat", "erection", "boner", "horny",
  "nazis", "kkk", "terrorist", "genocide", "killyourself",
];

const WHOLE_WORDS = [
  "ass", "arse", "asses", "fuk", "kys", "shit", "shits", "shitty", "dick", "dicks", "cock", "cocks", "tit",
  "tits", "titty", "titties", "boob", "boobs", "cum", "sex", "sexy", "porn", "porno", "slut",
  "sluts", "hoe", "hoes", "rape", "raped", "rapist", "anal", "anus", "fag", "fags", "nazi",
  "kike", "spic", "chink", "gook", "dyke", "coon", "negro", "damn", "crap", "piss", "pissed",
  "wank", "wanker", "twat", "prick", "nude", "nudes", "naked", "milf", "thot", "simp",
  "kill", "killer", "murder", "die", "dead", "suicide", "poop", "pee", "butthole",
  "weed", "cocaine", "meth", "heroin", "stupid", "idiot", "dumb", "loser", "ugly", "fat",
];

const RESERVED = [
  "admin", "administrator", "moderator", "staff", "support", "official", "system",
  "studysync", "studysyncteam", "developer", "helpdesk",
];

// Real names that happen to trip a rule. Compared to the whole squashed name, lowercase.
const ALLOWED = new Set([]);

const LETTERS_ONLY = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

// "José" → "jose", "Ⓕ" and full-width letters → plain, lowercase
function simplify(text) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// The ways a word might be stretched: as typed, every repeat squeezed to one
// ("fuuuck" → "fuck"), and long repeats squeezed to two ("asssss" → "ass")
function spellings(word) {
  return [...new Set([word, word.replace(/(.)\1+/g, "$1"), word.replace(/(.)\1{2,}/g, "$1$1")])];
}

// Words in the name. Runs of single letters are joined, so "f u c k" and "f.u.c.k" count
// as one word, while "Hiroshi Takahashi" stays two (no accidental words across a space).
function wordsOf(name) {
  const parts = simplify(name).split(/[\s.'’-]+/).filter(Boolean);
  const words = [];
  let run = "";
  for (const part of parts) {
    if (part.length === 1) { run += part; continue; }
    if (run) { words.push(run); run = ""; }
    words.push(part);
  }
  if (run) words.push(run);
  return words;
}

// null if the name is fine, otherwise { code, error } explaining why not
function checkName(name) {
  if (!LETTERS_ONLY.test(name)) {
    return { code: "name-chars", error: "Use letters only in your name (spaces, hyphens, apostrophes and periods are fine)." };
  }

  // Web addresses spelled with letters and periods ("www.site.com")
  if (/\bwww\b|\bhttps?\b|\.(com|net|org|edu|gov|io|gg|co|me|xyz|tv|app|ly|link|site|info|biz)\b/i.test(name)) {
    return { code: "name-chars", error: "Use your name, not a link." };
  }

  const words = wordsOf(name);
  const squashed = words.join("");
  if (ALLOWED.has(squashed)) return null;

  for (const word of words) {
    for (const form of spellings(word)) {
      if (SEVERE.some((bad) => form.includes(bad)) || WHOLE_WORDS.includes(form)) {
        return { code: "name-bad", error: "Please choose a different name. Your study group sees it, so keep it appropriate." };
      }
    }
  }
  // Two-word tricks like "Bull Shit" or "Study Sync": check the name as one word too
  for (const form of spellings(squashed)) {
    if (SEVERE.some((bad) => form.includes(bad) && bad.length >= 5)) {
      return { code: "name-bad", error: "Please choose a different name. Your study group sees it, so keep it appropriate." };
    }
  }
  if (words.some((w) => RESERVED.includes(w)) || RESERVED.some((r) => r.length >= 6 && squashed.includes(r))) {
    return { code: "name-reserved", error: "That name could look like StudySync staff. Please use your own name." };
  }
  return null;
}


// ---------- Free text members write (suggested meeting spots) ----------
// Much more lenient than names: everyday words and class vocabulary are fine.
// Only slurs and the harshest profanity are blocked, in any word of the text.
const CHAT_ANYWHERE = [
  "fuck", "nigger", "nigga", "faggot", "retard", "whore", "bitch", "motherf",
  "wetback", "tranny", "killyourself",
];
const CHAT_WHOLE_WORDS = ["cunt", "cunts", "fag", "fags", "kike", "spic", "chink", "gook", "slut", "sluts", "kys", "fck", "fuk"];

// null if the message is fine, otherwise { error }
function checkMessage(text) {
  const words = simplify(text).split(/[^\p{L}]+/u).filter(Boolean);
  // Also join runs of single letters, so "f u c k" is caught
  const joined = [];
  let run = "";
  for (const w of words) {
    if (w.length === 1) { run += w; continue; }
    if (run.length > 1) joined.push(run);
    run = "";
    joined.push(w);
  }
  if (run.length > 1) joined.push(run);

  for (const word of joined) {
    for (const form of spellings(word)) {
      if (CHAT_ANYWHERE.some((bad) => form.includes(bad)) || CHAT_WHOLE_WORDS.includes(form)) {
        return { error: "Please keep it respectful. Try rewording that." };
      }
    }
  }
  return null;
}

module.exports = { checkName, checkMessage };
