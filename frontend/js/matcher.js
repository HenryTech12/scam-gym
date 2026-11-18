// Reply matcher: maps a spoken or typed sentence to one of a node's choices.
// Pure functions, no DOM. When unsure it returns null and the UI asks the user to tap.
// Each language has its own stop words, boosts and negations; lists are never mixed.

const RULES = {
  en: {
    // "won't" -> "wont", so English negations stay single tokens.
    apostrophe: "",
    // Nigerian English particles and filler words are ignored.
    stop: ["abeg", "oga", "madam", "sir", "um", "umm", "uh", "uhh", "er", "erm", "ehn", "eh", "ah", "o", "oh", "sha", "jare", "biko", "abi", "like", "well", "just", "so", "hmm", "mm"],
    safeBoosts: ["hang up", "i will call", "ill call", "call you back", "no i will not", "not giving", "i will verify", "let me verify", "i will check", "i am not sending", "im not sending"],
    riskyBoosts: ["here is the code", "my pin is", "ok sending", "okay sending", "i have sent", "ive sent", "i don send", "the code is"],
    negations: ["not", "never", "wont", "dont", "cant", "cannot", "refuse", "nope", "no way"],
  },
  es: {
    apostrophe: " ",
    stop: ["eh", "em", "emm", "mmm", "pues", "bueno", "oye", "mire", "a ver", "ah", "o sea", "señor", "señora"],
    safeBoosts: ["voy a colgar", "cuelgo", "te llamo luego", "lo llamo despues", "no te voy a dar", "no le voy a dar", "voy a verificar", "verifico con mi banco", "llamo al banco", "no voy a enviar", "no voy a mandar"],
    riskyBoosts: ["aqui esta el codigo", "mi codigo es", "el codigo es", "ya envie", "ya te envie", "ya lo envie", "ya te lo mande", "ya transferi"],
    negations: ["no", "nunca", "jamás", "jamas", "nada", "ni", "tampoco"],
  },
  fr: {
    // "n'envoie" -> "n envoie", so the elided negation "n" is its own token.
    apostrophe: " ",
    stop: ["euh", "heu", "ben", "bah", "hein", "alors", "eh", "ah", "oh", "genre", "monsieur", "madame"],
    safeBoosts: ["je raccroche", "je rappelle", "je vous rappelle", "je ne donne rien", "je ne donnerai pas", "je vais verifier", "je verifie", "je n envoie rien", "je ne vais pas envoyer"],
    riskyBoosts: ["voici le code", "mon code est", "le code est", "j ai envoye", "je vous ai envoye", "c est envoye", "j ai fait le virement"],
    negations: ["ne", "n", "pas", "jamais", "rien", "aucun", "aucune", "non"],
  },
};
const BOOST = 2;

export const MIN_SCORE = 2;
export const MIN_CONFIDENCE = 0.55;
export const LANGS = Object.keys(RULES);

const rulesFor = (lang) => RULES[lang] || RULES.en;
const stopSets = new Map();

function baseNormalize(text, lang, keepMarks = false) {
  const lower = String(text || "").toLowerCase().normalize("NFC");
  // Strip diacritics for keyword comparison only: "código" == "codigo".
  return (keepMarks ? lower : lower.normalize("NFD").replace(/\p{M}/gu, ""))
    .replace(/[’'`]/g, rulesFor(lang).apostrophe)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalize(text, lang = "en") {
  if (!stopSets.has(lang)) {
    const words = rulesFor(lang).stop.map((w) => baseNormalize(w, lang));
    stopSets.set(lang, { single: new Set(words.filter((w) => !w.includes(" "))), multi: words.filter((w) => w.includes(" ")) });
  }
  const { single, multi } = stopSets.get(lang);
  let out = ` ${baseNormalize(text, lang)} `;
  for (const phrase of multi) out = out.split(` ${phrase} `).join(" ");
  return out
    .split(" ")
    .filter((w) => w && !single.has(w))
    .join(" ");
}

function contains(padded, phrase, lang) {
  const p = normalize(phrase, lang);
  return p.length > 0 && padded.includes(` ${p} `);
}

// Negations are checked with accents kept, so French "né" (born) is not read as "ne".
function hasNegation(text, lang) {
  const padded = ` ${baseNormalize(text, lang, true)} `;
  return rulesFor(lang).negations.some((n) => padded.includes(` ${n} `));
}

export function scoreChoices(text, choices, lang = "en") {
  const rules = rulesFor(lang);
  const norm = normalize(text, lang);
  const padded = ` ${norm} `;
  const safeBoost = rules.safeBoosts.some((p) => contains(padded, p, lang)) ? BOOST : 0;
  // A code-like run of 4+ digits counts as reading out a code.
  const codeLike = /\b\d{4,}\b/.test(norm.replace(/(\d) (?=\d)/g, "$1"));
  const riskyBoost = rules.riskyBoosts.some((p) => contains(padded, p, lang)) || codeLike ? BOOST : 0;

  return choices.map((c) => {
    let score = 0;
    for (const kw of c.keywords || []) {
      if (contains(padded, kw, lang)) score += normalize(kw, lang).includes(" ") ? 2 : 1;
    }
    if (c.type === "safe") score += safeBoost;
    if (c.type === "risky") score += riskyBoost;
    return { choice: c, score };
  });
}

export function match(text, choices, lang = "en") {
  if (!text || !choices?.length) return null;
  const scored = scoreChoices(text, choices, lang).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1]?.score ?? 0;
  const confidence = best.score / (best.score + second + 1);
  if (best.score < MIN_SCORE || confidence < MIN_CONFIDENCE) return null;
  // Never act on a risky reply that contains a negation ("I won't read the code").
  if (best.choice.type === "risky" && hasNegation(text, lang)) return null;
  return { choiceId: best.choice.id, confidence: Math.round(confidence * 100) / 100 };
}
