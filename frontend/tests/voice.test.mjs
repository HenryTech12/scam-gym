import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVoice, LOCALES } from "../js/voice.js";

const v = (lang, name = lang) => ({ lang, name });

test("prefers the primary locale, then fallbacks, then any voice of the language", () => {
  assert.equal(pickVoice([v("en-US"), v("en-GB"), v("en-NG")], "en").lang, "en-NG");
  assert.equal(pickVoice([v("en-US"), v("en-GB")], "en").lang, "en-GB");
  assert.equal(pickVoice([v("es-US"), v("es-MX")], "es").lang, "es-MX");
  assert.equal(pickVoice([v("fr_CA"), v("en-GB")], "fr").lang, "fr_CA");
  assert.equal(pickVoice([v("es-AR")], "es").lang, "es-AR");
});

test("never picks a voice of another language", () => {
  assert.equal(pickVoice([v("en-GB"), v("en-US")], "fr"), null);
  assert.equal(pickVoice([v("fr-FR")], "es"), null);
  assert.equal(pickVoice([], "en"), null);
});

test("recognition locales follow the addendum", () => {
  assert.deepEqual(LOCALES, { en: ["en-NG", "en-GB", "en-US"], es: ["es-ES", "es-MX", "es-US"], fr: ["fr-FR", "fr-CA"] });
});
