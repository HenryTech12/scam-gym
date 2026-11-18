// UI strings. Loads i18n/<lang>.json, falls back to English for any missing key.
// No cookies and no storage: the language comes from ?lang= or the browser settings.

export const LANGS = ["en", "es", "fr"];
export const LANG_NAMES = { en: "English", es: "Español", fr: "Français" };

const DEV = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

let lang = "en";
let strings = {};
let fallback = {};
const listeners = new Set();
const packs = new Map();

async function loadPack(code) {
  if (!packs.has(code)) {
    packs.set(
      code,
      fetch(`i18n/${code}.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
    );
  }
  return packs.get(code);
}

export function isSupported(code) {
  return LANGS.includes(code);
}

// ?lang= wins, then the first supported entry of navigator.languages, then English.
export function detectLang() {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && isSupported(q.toLowerCase())) return q.toLowerCase();
  } catch {
    /* ignore */
  }
  const prefs = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
  for (const p of prefs) {
    const code = String(p || "").slice(0, 2).toLowerCase();
    if (isSupported(code)) return code;
  }
  return "en";
}

export async function setLang(code) {
  const next = isSupported(code) ? code : "en";
  const [en, pack] = await Promise.all([loadPack("en"), loadPack(next)]);
  fallback = en;
  strings = pack;
  lang = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const fn of listeners) fn(next);
  return next;
}

export function getLang() {
  return lang;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// t("call.pressureOf", { n: 2 }) -> "2 of 4". Placeholders are {name}; values are plain text.
export function t(key, vars) {
  let s = strings[key];
  if (s === undefined || s === "") {
    if (DEV && lang !== "en") console.warn(`[i18n] missing ${lang} key: ${key}`);
    s = fallback[key];
  }
  if (s === undefined) {
    if (DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : s;
}
