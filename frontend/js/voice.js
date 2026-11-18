// Optional voice layer. Off by default. Never throws to the UI.

const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const LISTEN_TIMEOUT_MS = 8000;

let activeRecognition = null;

export function isSupported() {
  return Boolean(synth && Recognition && typeof window.SpeechSynthesisUtterance === "function");
}

function pickVoice() {
  const voices = synth.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
  const byLang = (prefix) => voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));
  return byLang("en-ng") || byLang("en-gb") || voices[0] || null;
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

// Resolves when speaking ends (or fails). Captions are shown by the UI regardless.
export function speak(text, voiceHint) {
  return new Promise((resolve) => {
    if (!synth) return resolve(false);
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-GB";
      }
      utterance.pitch = voiceHint === "female" ? 1.15 : 0.9;
      utterance.rate = 0.95;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      synth.speak(utterance);
    } catch {
      resolve(false);
    }
  });
}

// Resolves to { transcript } or { transcript: null, error } after at most 8 seconds.
export function listen() {
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
      rec.lang = "en-NG";
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
