// Reply matcher: maps a spoken or typed sentence to one of a node's choices.
// Pure functions, no DOM. When unsure it returns null and the UI asks the user to tap.

// Nigerian English particles and filler words are ignored.
const STOP_WORDS = new Set([
  "abeg", "oga", "madam", "sir", "um", "umm", "uh", "uhh", "er", "erm", "ehn", "eh", "ah",
  "o", "oh", "sha", "jare", "biko", "abi", "like", "well", "just", "so", "hmm", "mm",
]);

// Global intent boosts, applied once per type when any phrase matches.
const SAFE_BOOSTS = [
  "hang up", "i will call", "ill call", "call you back", "no i will not", "not giving",
  "i will verify", "let me verify", "i will check", "i am not sending", "im not sending",
];
const RISKY_BOOSTS = [
  "here is the code", "my pin is", "ok sending", "okay sending", "i have sent", "ive sent",
  "i don send", "the code is",
];
const BOOST = 2;

// If the best match is risky and the sentence contains a negation, never act on it.
const NEGATIONS = new Set(["not", "never", "wont", "dont", "cant", "cannot", "refuse", "nope", "no way"]);

export const MIN_SCORE = 2;
export const MIN_CONFIDENCE = 0.55;

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
}

function contains(padded, phrase) {
  const p = normalize(phrase);
  return p.length > 0 && padded.includes(` ${p} `);
}

function phraseScore(phrase) {
  return normalize(phrase).includes(" ") ? 2 : 1;
}

function hasNegation(padded) {
  for (const n of NEGATIONS) if (padded.includes(` ${n} `)) return true;
  return false;
}

export function scoreChoices(text, choices) {
  const norm = normalize(text);
  const padded = ` ${norm} `;
  const safeBoost = SAFE_BOOSTS.some((p) => contains(padded, p)) ? BOOST : 0;
  // A code-like run of 4+ digits counts as reading out a code.
  const codeLike = /\b\d{4,}\b/.test(norm.replace(/(\d) (?=\d)/g, "$1"));
  const riskyBoost = RISKY_BOOSTS.some((p) => contains(padded, p)) || codeLike ? BOOST : 0;

  return choices.map((c) => {
    let score = 0;
    for (const kw of c.keywords || []) if (contains(padded, kw)) score += phraseScore(kw);
    if (c.type === "safe") score += safeBoost;
    if (c.type === "risky") score += riskyBoost;
    return { choice: c, score };
  });
}

export function match(text, choices) {
  if (!text || !choices?.length) return null;
  const scored = scoreChoices(text, choices).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1]?.score ?? 0;
  const confidence = best.score / (best.score + second + 1);
  if (best.score < MIN_SCORE || confidence < MIN_CONFIDENCE) return null;
  if (best.choice.type === "risky" && hasNegation(` ${normalize(text)} `)) return null;
  return { choiceId: best.choice.id, confidence: Math.round(confidence * 100) / 100 };
}
