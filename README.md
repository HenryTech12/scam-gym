# Scam Gym

**Practice the call before the scammer makes it.**

Scam Gym is a browser-based, voice-first fire drill for scams. You take a simulated scam call, reply by voice or by tapping, and get a debrief. The debrief names each pressure tactic the caller used and the safer reply you could have given.

It trains one skill: **stop, do not act on what the caller gave you, and verify through a channel you already trust.** That means calling the number on your card, checking your own banking app, or asking for the family code word.

Built for SafeSpace Hacks. It is for everyday phone and mobile-banking users in Nigeria, POS agents, and relatives running the drill with older family members.

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

## Tests

```
pytest backend                                # API, rephrase validators, scenario validator
node --test frontend/tests/*.test.mjs         # drill engine and reply matcher
```

`backend/tests/test_scenarios.py` validates `frontend/data/scenarios.json`. It checks reachability, choice counts, safe exits, cycles, depth, tactics, ends, and blocks real brand names, URLs and phone numbers. Run it after any script edit.

## How it works

```
frontend/            static PWA, no framework, no build step
  js/engine.js       pure, deterministic drill state machine
  js/matcher.js      maps a spoken sentence to a choice; returns null rather than guess
  js/voice.js        optional Web Speech wrapper; never throws to the UI
  js/debrief.js      builds the debrief from the run history
  js/study.js        optional before-and-after study
  js/api.js          fetch wrappers, 2 second timeout, null on any failure
  data/              scenarios.json and study_items.json (bundled)
backend/             FastAPI: health, scenarios, rephrase, study, static files
scripts/export_study_csv.py
```

- **Reliability first.** The drill needs no backend, no microphone and no AI. Each of those is an extra with a fallback.
- **Voice is off by default.** When it is on, every caller line is still shown as a caption. The matcher never auto-selects at low confidence. It refuses a risky option when the sentence contains a negation ("I won't read the code"). When unsure, it asks you to tap.
- **Optional rephrasing** (`LLM_ENABLED=true`, `LLM_PROVIDER=anthropic`, `LLM_API_KEY`, optional `LLM_MODEL`; the provider SDK is needed only then: `pip install anthropic`). The server rephrases its own copy of the line; the client never sends text. A rephrased line is used only if it passes every validator: length, same numbers and names, no URL, phone number or email, no new request for information, and no real brand or new agency names. Otherwise the original line is used.

## Privacy and safety

- No accounts, no cookies, no analytics, no third-party requests, no external fonts.
- Strict Content-Security-Policy (`default-src 'self'`), `nosniff` and `no-referrer` headers. All dynamic text goes through `textContent`.
- Nothing typed or said during a drill is stored or sent. The family code word never leaves the page.
- The study stores only answers (`comply` or `verify`), the item sets, the drills played and a random UUID, and only after the participant consents. No IP addresses, user agents or names are stored, and study request bodies are never logged. Validation errors never echo submitted values.
- Write endpoints are rate-limited to 30 requests per minute per IP, in memory only.

## Before-and-after study

Open `#/study`. The flow is consent, then 5 questions, then any two drills, then 5 different questions. Question sets A and B are randomly ordered per participant. `GET /api/study/summary` returns `n`, the before and after verify rates, `change_points` and per-item rates, labelled "Small sample, self-reported". The About page shows the chart. Export with `python scripts/export_study_csv.py`.

## Limitation

Scam Gym builds a habit through simulated practice. It cannot detect or stop real scams, and a real caller with a spoofed number or detailed personal information may be more convincing than any drill.

## Credits

- Browser Web Speech APIs (speech synthesis and speech recognition)
- FastAPI, Uvicorn, Pydantic
- LLM provider: none by default. Optional rephrasing supports Anthropic's Claude API when enabled by the host.

Built during Oct 17 to Nov 22, 2026 with AI coding assistance (Claude Code).

**Pre-existing components:** None.

## Notes on the spec

`SPEC.md` is the source of truth. These choices resolve places where its rules and scripts disagreed:

- **Stall pressure.** The rule says a stall leads to a node with more tactics. Three follow-up lines were tagged with the tactics their words already use, so the rule holds. Bank n3 adds `fear` and `fake_proof` ("they will empty the account", the staff ID). Family n3 adds `rush` and `emotion` ("send it now", "Please, Mum"). POS n3 adds `deadline` ("I will be late").
- **Family code word.** In the script, "Ask for our family code word" is a safe choice that leads to another node, not an end. It is kept as scripted. The validator checks that every safe choice that leads to a node still reaches a safe end.
- **Extra scenario fields.** `notice` labels the simulated cloned voice on screen. `offer_family_code` shows the "Set a family code word" debrief button. `visual` holds the fictional alert message on POS n2.
- **Matcher additions.** A negation guard for risky choices, and a spoken 4+ digit code counts as reading out a code.
