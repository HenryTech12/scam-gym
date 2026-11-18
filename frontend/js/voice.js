// Optional voice layer. Off by default. Never throws to the UI.

const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const LISTEN_TIMEOUT_MS = 8000;
const VOICES_TIMEOUT_MS = 1000;

// Preferred locales per language, primary first.
export const LOCALES = {
  en: ["en-NG", "en-GB", "en-US"],
  es: ["es-ES", "es-MX", "es-US"],
  fr: ["fr-FR", "fr-CA"],
};

let activeRecognition = null;

export function isSupported() {
  return Boolean(synth && Recognition && typeof window.SpeechSynthesisUtterance === "function");
}

// Browser voices load asynchronously: wait for "voiceschanged", at most 1 second.
function loadVoices() {
  return new Promise((resolve) => {
    let voices = [];
    try {
      voices = synth.getVoices();
    } catch {
      /* ignore */
    }
    if (voices.length) return resolve(voices);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        synth.removeEventListener?.("voiceschanged", finish);
        resolve(synth.getVoices() || []);
      } catch {
        resolve([]);
      }
    };
    try {
      synth.addEventListener?.("voiceschanged", finish);
    } catch {
      /* ignore */
    }
    setTimeout(finish, VOICES_TIMEOUT_MS);
  });
}

const norm = (l) => String(l || "").toLowerCase().replace("_", "-");

// Exported for tests: picks a voice for the language, never one of another language.
export function pickVoice(voices, lang) {
  const code = (LOCALES[lang] ? lang : "en").toLowerCase();
  const ofLang = (voices || []).filter((v) => norm(v.lang).startsWith(code));
  for (const locale of LOCALES[code] || []) {
    const v = ofLang.find((x) => norm(x.lang).startsWith(norm(locale)));
    if (v) return v;
  }
  return ofLang[0] || null;
}

export function cancel() {
  try {
    synth?.cancel();
  } catch {
    /* ignore */
  }
  try {
    activeRecognition?.abort();
  } catch {
    /* ignore */
  }
  activeRecognition = null;
}

// Resolves to "spoken", "no-voice" (no voice for this language: captions only) or "failed".
export async function speak(text, voiceHint, lang = "en") {
  if (!synth) return "failed";
  const voice = pickVoice(await loadVoices(), lang);
  if (!voice) return "no-voice";
  return new Promise((resolve) => {
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.pitch = voiceHint === "female" ? 1.15 : 0.9;
      utterance.rate = 0.95;
      utterance.onend = () => resolve("spoken");
      utterance.onerror = () => resolve("failed");
      synth.speak(utterance);
    } catch {
      resolve("failed");
    }
  });
}

// Resolves to { transcript } or { transcript: null, error } after at most 8 seconds.
export function listen(lang = "en") {
  return new Promise((resolve) => {
    if (!Recognition) return resolve({ transcript: null, error: "unsupported" });
    let done = false;
    let rec;
    const finish = (transcript, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      if (activeRecognition === rec) activeRecognition = null;
      resolve({ transcript: transcript || null, error: transcript ? null : error || "no-speech" });
    };
    const timer = setTimeout(() => finish(null, "timeout"), LISTEN_TIMEOUT_MS);
    try {
      try {
        synth?.cancel();
      } catch {
        /* ignore */
      }
      rec = new Recognition();
      activeRecognition = rec;
      rec.lang = (LOCALES[lang] || LOCALES.en)[0]; // primary locale, no probing
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => finish(event.results?.[0]?.[0]?.transcript?.trim() || null, "no-speech");
      // Covers "no-speech", "not-allowed", "network", "aborted" and anything else.
      rec.onerror = (event) => finish(null, event?.error || "error");
      rec.onend = () => finish(null, "no-speech");
      rec.start();
    } catch {
      finish(null, "error");
    }
  });
}
