// StudySync - builds public/dark.css (dark mode) from the other stylesheets.
//
// Run after changing colors in any stylesheet:   node scripts/build-dark-css.js
//
// For every rule that sets a color, it writes the same rule under html[data-theme="dark"]
// with the color flipped for a dark background:
//   light backgrounds → dark surfaces (cards a little lighter than the page)
//   dark / gray text  → light text;  colored text (links, errors) → brighter so it's readable
//   colored backgrounds (buttons, chips) and white text on them → kept as they are
//   light borders     → subtle dark borders
// public/theme.js sets data-theme on <html>. Hand-written fixes go in EXTRA at the bottom.

const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public");
const SOURCES = ["style.css", "dashboard.css", "landing.css", "notebook.css", "canvas.css"];
const OUT = path.join(PUBLIC, "dark.css");
const PREFIX = 'html[data-theme="dark"]';

// ---------- Colors ----------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function parseColor(text) {
  if (NAMED[text]) return NAMED[text].slice();
  if (text[0] === "#") {
    let h = text.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const parts = text.replace(/rgba?\(|\)/g, "").split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// role: "text" | "bg" | "border" | "shadow"
function flip(text, role) {
  const c = parseColor(text);
  if (!c) return text;
  const alpha = c[3];
  let [h, s, l] = toHsl(c);
  const colorful = s > 0.3 && l > 0.12 && l < 0.88;
  // Plain white / gray surfaces and borders get a faint StudySync blue instead of flat gray
  if (s < 0.05 && (role === "bg" || role === "border") && l >= 0.7) { h = 228; s = 0.22; }

  if (role === "text") {
    if (l >= 0.93) return text;                         // white text sits on a colored button: keep
    if (colorful) l = clamp(l + 0.25, 0.68, 0.82);      // links, errors, success: brighter
    else l = clamp(1 - l, 0.55, 0.92);                  // grays: flip
  } else if (role === "bg") {
    if (l >= 0.8) { l = 0.06 + (l - 0.8) * 0.5; s *= 0.6; } // light surfaces → dark (white → lightest)
    else if (colorful) return text;                      // buttons, chips: keep
    else l = 1 - l;
  } else if (role === "border") {
    if (l >= 0.7) { l = 0.22 + (l - 0.7) * 0.4; s *= 0.5; }
    else if (colorful) l = clamp(l + 0.12, 0.5, 0.75);
    else l = 1 - l;
  } else if (role === "shadow") {
    if (l < 0.5) return text;                            // dark shadows work on dark too
    l = 0.05;
  }
  const rgb = fromHsl(h, s, l);
  return alpha < 1 ? `rgba(${rgb.join(", ")}, ${+alpha.toFixed(3)})` : hex(rgb);
}

function roleFor(property) {
  if (/^(color|fill|stroke|caret-color|text-decoration-color|accent-color)$/.test(property)) return "text";
  if (/^background/.test(property)) return "bg";
  if (/^(border|outline|column-rule)/.test(property)) return "border";
  if (/shadow$/.test(property)) return "shadow";
  return null;
}

// ---------- A small CSS reader: rules, and rules inside @media ----------
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const items = [];
  let i = 0;
  function readBlock(start) {
    let depth = 0;
    for (let j = start; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) return j;
    }
    return css.length;
  }
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    const close = readBlock(open);
    const body = css.slice(open + 1, close);
    if (head.startsWith("@media") || head.startsWith("@supports")) items.push({ at: head, rules: parse(body) });
    else if (!head.startsWith("@")) items.push({ selector: head, body });
    i = close + 1;
  }
  return items;
}

function prefixSelector(selector) {
  return selector.split(",").map((s) => {
    s = s.trim();
    if (!s) return s;
    if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, PREFIX);
    return PREFIX + " " + s;
  }).join(", ");
}

function darkRule(rule) {
  const out = [];
  for (const decl of rule.body.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const property = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    const role = roleFor(property);
    if (!role || !COLOR.test(value)) { COLOR.lastIndex = 0; continue; }
    COLOR.lastIndex = 0;
    const flipped = value.replace(COLOR, (m) => flip(m, role));
    if (flipped !== value) out.push(`  ${property}: ${flipped};`);
  }
  return out.length ? `${prefixSelector(rule.selector)} {\n${out.join("\n")}\n}` : "";
}

function render(items, indent = "") {
  const blocks = [];
  for (const item of items) {
    if (item.at) {
      const inner = render(item.rules, "  ");
      if (inner) blocks.push(`${item.at} {\n${inner}\n}`);
    } else {
      const rule = darkRule(item);
      if (rule) blocks.push(rule.split("\n").map((line) => indent + line).join("\n"));
    }
  }
  return blocks.join("\n");
}

// ---------- Hand-written extras ----------
const EXTRA = `
/* ---------- Hand-written (scripts/build-dark-css.js, EXTRA) ---------- */
${PREFIX} { color-scheme: dark; }
${PREFIX} body { background: #0f1220; color: #dfe3f0; }
${PREFIX} p, ${PREFIX} label { color: #b9bfd3; }
${PREFIX} h1, ${PREFIX} h2, ${PREFIX} h3, ${PREFIX} h4, ${PREFIX} strong { color: #e8ebf6; }
${PREFIX} a { color: #8ea2f5; }
${PREFIX} input, ${PREFIX} select, ${PREFIX} textarea { background: #1a1f33; color: #e8ebf6; border-color: #343b57; }
${PREFIX} input::placeholder, ${PREFIX} textarea::placeholder { color: #7d849c; }
${PREFIX} button { color: #fff; }
/* The dropdown arrow (the background rule above would otherwise remove it) */
${PREFIX} select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23aab2cc' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
/* Notebook: the question box sits inside its own bordered box, and a waiting Send button stays quiet */
${PREFIX} .composer-box textarea { background: transparent; border: none; }
${PREFIX} .composer-send:disabled, ${PREFIX} .composer-send:disabled:hover { background: #30364c; color: #7d849c; }
${PREFIX} .sc-form input { background: transparent; border: none; }
${PREFIX} .sc-send:disabled, ${PREFIX} .sc-send:disabled:hover { background: #30364c; color: #7d849c; }
${PREFIX} .sc-msg.mine .sc-bubble { background: #3b56d6; border-color: #3b56d6; color: #fff; }
${PREFIX} .ns-person::before { background: #5a6078; }
${PREFIX} .ns-person.going::before { background: #3fbf7f; }
${PREFIX} .ns-person.late::before { background: #f0ad3a; }
${PREFIX} .ns-person.cant::before { background: #ef6b67; }
${PREFIX} .nb-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
/* Discord button: white text on blurple, like in light mode (the link color above would dim it) */
${PREFIX} a.discord-button, ${PREFIX} a.discord-button:hover { color: #fff; }
${PREFIX} .discord-icon.discord-initials { background: #5865f2; color: #fff; }
/* The group page's "Auto-scheduled for you" banner: same gradient, keep its light-mode colors */
${PREFIX} .group-why { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3); }
${PREFIX} .group-why .group-why-title { color: #fff; }
${PREFIX} .group-why p { color: #e4e9ff; }
/* Study groups banner: it's already a dark gradient, so keep its light-mode colors
   (the automatic flips above would turn its text blue-on-blue) */
${PREFIX} .groups-hero { box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); }
${PREFIX} .groups-hero-eyebrow { color: #cdd6ff; }
${PREFIX} .groups-hero-title { color: #fff; }
${PREFIX} .groups-hero-title span { color: #8ff0c0; }
${PREFIX} .groups-hero-sub { color: #e4e9ff; }
${PREFIX} .groups-hero-features li { border: 1px solid rgba(255, 255, 255, 0.18); }
${PREFIX} .groups-hero-features strong { color: #fff; }
${PREFIX} .groups-hero-features li > span:last-child { color: #d5dcff; }
${PREFIX} .groups-hero-icon { background: #8ff0c0; color: #13235f; }
/* "On my own" banner: teal, also kept as in light mode */
${PREFIX} .solo-hero .groups-hero-title span { color: #fde68a; }
${PREFIX} .solo-hero .groups-hero-icon { background: #fde68a; color: #134e4a; }
${PREFIX} .solo-hero .groups-hero-eyebrow { color: #c5f1ee; }
${PREFIX} .solo-hero .groups-hero-sub { color: #e2f7f5; }
${PREFIX} .solo-hero .groups-hero-features li > span:last-child { color: #d3f0ee; }
${PREFIX} .solo-hero .groups-hero-features li { background: rgba(4, 40, 48, 0.28); border: 1px solid rgba(255, 255, 255, 0.18); }
/* Ticked "Studied" checkmark: keep the filled green circle */
${PREFIX} .study-check.on .study-check-box { border: none; background: none; color: #4cc46a; }
${PREFIX} .study-check span:not(.study-check-box) { color: inherit; }
/* Setup page schedule list: day chips tinted from each item's own color */
${PREFIX} .added-day { background: color-mix(in srgb, var(--c) 22%, #23262e); color: color-mix(in srgb, var(--c) 55%, #fff); }
${PREFIX} .added-top strong { color: #e3e7f7; }
${PREFIX} .added-item { border-left: 5px solid var(--c); }
${PREFIX} .added-remove { color: #ff8a80; background: transparent; }
${PREFIX} .added-remove:hover { background: #3a2226; border-color: #5c2b31; }
/* Group / Solo option cards: picked icon fills in, white tick in the circle, softer teal */
${PREFIX} .choice-card .choice-text strong { color: #e3e7f7; }
${PREFIX} .choice-card:has(input:checked) .choice-icon { background: #3b56d6; color: #fff; }
${PREFIX} .choice-card:has(input:checked) .choice-check {
  border-color: #3b56d6;
  background: #3b56d6 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpolyline points='2.5 6.5 5 9 9.5 3.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 14px no-repeat;
}
${PREFIX} .choice-solo:has(input:checked) { border-color: #2a9d92; background: #16302d; }
${PREFIX} .choice-solo:has(input:checked) .choice-icon { background: #0f766e; color: #fff; }
${PREFIX} .choice-solo:has(input:checked) .choice-check { border-color: #2a9d92; background-color: #0f766e; }
/* Dark-mode logo: navy "Study" turned light, brighter blue (public/logo-dark.png).
   theme.js swaps the image too, for browsers that ignore content on images. */
${PREFIX} img.logo { content: url("/public/logo-dark.png"); }
`;

let output = `/* StudySync dark mode. MADE BY scripts/build-dark-css.js: don't edit by hand, re-run the script.
   Active when <html data-theme="dark"> (set by public/theme.js). */
`;
for (const file of SOURCES) {
  const css = fs.readFileSync(path.join(PUBLIC, file), "utf8");
  const rendered = render(parse(css));
  if (rendered) output += `\n/* ---------- from ${file} ---------- */\n${rendered}\n`;
}
output += EXTRA;
fs.writeFileSync(OUT, output);
console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${output.split("\n").length} lines)`);
