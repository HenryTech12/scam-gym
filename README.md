# Scam Gym

**Practice the call before the scammer makes it.**

Scam Gym is a browser-based, voice-first fire drill for scams. You take a simulated scam call, reply by voice or by tapping, and get a debrief. The debrief names each pressure tactic the caller used and the safer reply you could have given.

It trains one skill: **stop, do not act on what the caller gave you, and verify through a channel you already trust.** That means calling the number on your card, checking your own banking app, or asking for the family code word.

Built for SafeSpace Hacks. It is for everyday phone and mobile-banking users in Nigeria, POS agents, and relatives running the drill with older family members. The whole app also works in **Spanish and French** (see [Languages](#languages)).

## The drills

| Drill | Who it is for | The safe move |
|---|---|---|
| The bank security call | Everyone | Hang up and call the number on your card |
| It's me, I'm in trouble (simulated cloned voice) | Families | Ask the family code word, or call their real number |
| The fake transfer alert | POS agents | Check your own banking app, not the SMS |

All people, banks and amounts are invented. "End call" is always available and always safe, because ending a call is always allowed.

## Run it

```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000
```

**Without the backend:** the drills run entirely in the browser. Any static server works, for example `cd frontend && python -m http.server 8080`. The study and optional rephrasing need the backend. Everything else falls back silently.

**Offline:** after the first load, the service worker caches the app and the scenarios, so drills keep working with no network.

## Languages

English (`en`), Spanish (`es`) and French (`fr`) cover everything: UI text, caller lines, replies, voice in and out, the debrief, the family code word message, the study and the About page.

- **Choosing a language.** The app uses `?lang=es` if it is set. Otherwise it takes the first match in the browser's language list, and falls back to English. A selector on Home and in the header switches language without reloading the page, and the change is announced to screen readers. The selector is hidden during a call. Nothing is stored: no cookies and no `localStorage`.
- **Files.** `frontend/i18n/<lang>.json` holds UI strings, with English as the fallback for any missing key. `frontend/data/scenarios.<lang>.json` and `study_items.<lang>.json` hold the drills and study items. All three scenario files have identical structure: the same ids, types, targets, tactics and ends. Only text and voice keywords differ.
- **Localization choices:**
  - English keeps the Nigeria-specific details: BVN, ₦, POS agents and Pidgin.
  - In Spanish and French, the bank drill threatens to block your card rather than your BVN.
  - In Spanish and French, the transfer-alert drill is framed for a shop or market seller. The customer wants to leave with the goods. The drill id stays `pos-alert`.
  - The fictional bank is "Kestrel Bank" everywhere. Callers are Sr. Delgado and M. Lefèvre, and the relative is "Diego" in Spanish and "Julien" in French.
  - "If this happened for real" names no agencies in Spanish or French. It says to report to the local police or the national consumer or cybercrime authority.
- **Currency.** The ₦ symbol appears only in the English file. Spanish and French amounts have no currency symbol or word, written with local digit grouping: `180.000` in Spanish, `180 000` in French. The numbers match English.
- **Voice.**
  - Recognition uses `en-NG`, `es-ES` or `fr-FR` for the language.
  - Speech output uses a voice of the same language, preferring `en-NG`/`en-GB`/`en-US`, `es-ES`/`es-MX`/`es-US`, or `fr-FR`/`fr-CA`. If the device has no voice for the language, it never speaks in another language's voice. It shows captions only, with a short note.
- **Matching.**
  - Each language has its own keywords, at least 8 per choice. It also has its own filler words, intent boosts and negations, and English phrases are never matched in a Spanish or French session.
  - Accents are ignored when comparing ("codigo" matches "código"). Negations are checked with accents kept, so French "né" (born) is not read as "ne".
- **Offline.** The service worker caches the app and English at install, then the current language. Other languages are cached when first opened. Drills work offline in every language already opened.
- **Review status.** Spanish and French text was drafted with AI assistance and has not been reviewed by a native speaker yet.

## Tests

```
pytest backend                                # API, rephrase validators, scenario + i18n validators
node --test frontend/tests/*.test.mjs         # drill engine, reply matcher, voice picker
```

`backend/tests/test_scenarios.py` validates every `scenarios.<lang>.json`:
- reachability, choice counts, safe exits, cycles, depth, tactics and ends
- structure parity between every pair of languages
- at least 8 keywords per choice, with no phrase shared by two choices of one node
- lines of at most 45 words
- no real brand names, URLs or phone numbers

`backend/tests/test_i18n.py` checks that every English UI key exists in Spanish and French and that no value is empty. Run both after any script or string edit.

## How it works

```
frontend/            static PWA, no framework, no build step
  js/i18n.js         t(key, vars), setLang(), getLang(), onChange(); English fallback
  js/engine.js       pure, deterministic drill state machine
  js/matcher.js      maps a spoken sentence to a choice, per language; returns null rather than guess
  js/voice.js        optional Web Speech wrapper; never throws to the UI
  js/debrief.js      builds the debrief from the run history
  js/study.js        optional before-and-after study
  js/api.js          fetch wrappers, 2 second timeout, null on any failure
  i18n/              en.json, es.json, fr.json (UI strings)
  data/              scenarios.<lang>.json and study_items.<lang>.json (bundled)
backend/             FastAPI: health, scenarios, rephrase, study, static files
scripts/export_study_csv.py
```

- **Reliability first.** The drill needs no backend, no microphone and no AI. Each of those is an extra with a fallback.
- **Voice is off by default.** When it is on, every caller line is still shown as a caption. The matcher never auto-selects at low confidence. It refuses a risky option when the sentence contains a negation ("I won't read the code"). When unsure, it asks you to tap.
- **Optional rephrasing** (`LLM_ENABLED=true`, `LLM_PROVIDER=anthropic`, `LLM_API_KEY`, optional `LLM_MODEL`; the provider SDK is needed only then: `pip install anthropic`). The client sends only the scenario, node and `lang`, never text. The server rephrases its own copy of the line in that language.
  - A rephrased line is used only if it passes every validator: length, same numbers and names, no URL, phone number or email, no new request for information, and no real brand or new agency names.
  - In Spanish and French it must also pass a language check: it must not equal the English line, and must contain no more than 3 English stop words.
  - Otherwise the original line is used.

## Privacy and safety

- No accounts, no cookies, no analytics, no third-party requests, no external fonts.
- Strict Content-Security-Policy (`default-src 'self'`), `nosniff` and `no-referrer` headers. All dynamic text goes through `textContent`.
- Nothing typed or said during a drill is stored or sent. The family code word never leaves the page.
- The study stores only answers (`comply` or `verify`), the item sets, the drills played and a random UUID, and only after the participant consents. No IP addresses, user agents or names are stored, and study request bodies are never logged. Validation errors never echo submitted values.
- Write endpoints are rate-limited to 30 requests per minute per IP, in memory only.

## Before-and-after study

Open `#/study`. The flow is consent, then 5 questions, then any two drills, then 5 different questions. Question sets A and B are randomly ordered per participant. Item ids are the same in every language, so results stay comparable, and each session records its `lang`.

`GET /api/study/summary` returns the following, labelled "Small sample, self-reported" (localized on the page):
- `n`
- the before and after verify rates
- `change_points`
- per-item rates
- `by_lang` counts

Add `?lang=es` to filter by language. With no filter, all languages are combined. Older databases get the `lang` column automatically on startup. `GET /api/scenarios?lang=fr` returns that language's file, and an invalid `lang` returns 400.

The About page shows the chart. Export with `python scripts/export_study_csv.py`.

## Limitation

Scam Gym builds a habit through simulated practice. It cannot detect or stop real scams, and a real caller with a spoofed number or detailed personal information may be more convincing than any drill.

Voice recognition accuracy varies by accent, device and browser. Tap mode is always available.

## Credits

- Browser Web Speech APIs (speech synthesis and speech recognition)
- FastAPI, Uvicorn, Pydantic
- LLM provider: none by default. Optional rephrasing supports Anthropic's Claude API when enabled by the host.

Built during Oct 17 to Nov 22, 2026 with AI coding assistance (Claude Code).

Spanish and French text was drafted with AI assistance and has not been reviewed by a native speaker yet.

**Pre-existing components:** None.

## Notes on the spec

`SPEC.md` is the source of truth. These choices resolve places where its rules and scripts disagreed:

- **Stall pressure.** The rule says a stall leads to a node with more tactics. Three follow-up lines were tagged with the tactics their words already use, so the rule holds. Bank n3 adds `fear` and `fake_proof` ("they will empty the account", the staff ID). Family n3 adds `rush` and `emotion` ("send it now", "Please, Mum"). POS n3 adds `deadline` ("I will be late").
- **Family code word.** In the script, "Ask for our family code word" is a safe choice that leads to another node, not an end. It is kept as scripted. The validator checks that every safe choice that leads to a node still reaches a safe end.
- **Extra scenario fields.** `notice` labels the simulated cloned voice on screen. `offer_family_code` shows the "Set a family code word" debrief button. `visual` holds the fictional alert message on POS n2.
- **Matcher additions.** A negation guard for risky choices, and a spoken 4+ digit code counts as reading out a code.
- **Addendum A.** The debrief label "Money lost (in the drill)" is now "Loss (in the drill)". In the Spanish and French seller drill, the loss is goods rather than cash. "Claro" is left out of the blocked-brand list because it is everyday Spanish for "of course".
