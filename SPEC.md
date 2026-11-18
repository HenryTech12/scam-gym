# Scam Gym: Technical Specification

Hand this file to Claude Code as the single source of truth. Build exactly what is described, in the order in Section 17, and do not add features that are not listed.

---

## 1. Product summary

**Scam Gym** is a browser-based, voice-first fire drill for scams. The user takes a simulated scam call, replies by voice or by tapping, and gets a debrief that names each pressure tactic the caller used and the safer reply that was available.

- **Tagline:** Practice the call before the scammer makes it.
- **Hackathon:** SafeSpace Hacks (Devpost). Submission deadline: Nov 22, 2026, 5:00 PM Eastern.
- **Users:** everyday phone and mobile-banking users in Nigeria, POS agents, and relatives running the drill with older family members.
- **One skill trained:** stop, do not act on what the caller gave you, and verify through a channel you already trust (call the number on your card, check your own banking app, ask the family code word).

### Non-goals (do not build)
User accounts, login, payments, real phone calls, real SMS, scam detection of real messages, browser extensions, push notifications, analytics trackers, third-party ad or tracking scripts.

---

## 2. Design principles (these drive judging scores)

1. **Reliability first.** The core drill must work with no backend, no microphone and no AI service. Voice, AI and backend are enhancements with fallbacks.
2. **Fictional only.** Invented people and invented organizations. No real bank, telecom or brand names. The only real organization named is the EFCC, and only in the "if this happened for real" guidance.
3. **No personal data.** No accounts. Nothing typed by the user during a drill is stored or sent anywhere.
4. **Honest scope.** The app builds practice. It never claims to detect, block or prevent real scams.
5. **Plain language.** Short sentences, sentence case, active voice. Large text. Works on a mid-range Android phone.

---

## 3. Architecture

```
┌─────────────────────────── Browser (static PWA) ───────────────────────────┐
│  UI screens  →  Drill Engine (pure JS)  →  Reply Matcher                    │
│        │              │                         │                           │
│  Voice layer     Scenario JSON (bundled)   Debrief builder                  │
│  (Web Speech)         │                                                     │
└──────────┬────────────┴─────────────────────────────────────────────────────┘
           │ optional, all with fallback
           ▼
┌──────────────── FastAPI backend (Python 3.11+) ────────────────┐
│  GET  /api/scenarios            (serves same JSON as bundled)    │
│  POST /api/rephrase             (optional LLM wording variation) │
│  POST /api/study/session        (consent-based study results)    │
│  GET  /api/study/summary        (aggregates for the chart)       │
│  GET  /api/health                                                │
│  SQLite (study results only)                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Key rule:** the frontend bundles `scenarios.json` and runs the entire drill locally. The backend is only used for (a) optional rephrasing, (b) the anonymous before/after study, (c) serving the static files. If any API call fails or exceeds 2 seconds, the frontend silently falls back and continues.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Plain HTML, CSS, ES modules (no framework, no build step) | Fast to load, easy for judges to inspect |
| Voice out | `window.speechSynthesis` | Opt-in, always show captions |
| Voice in | `SpeechRecognition` / `webkitSpeechRecognition` | Opt-in, hidden if unsupported |
| PWA | `manifest.webmanifest` + service worker that caches the app shell and `scenarios.json` | Drill works offline |
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 | Serves static files from `/frontend` |
| Storage | SQLite via `sqlite3` | Study results only |
| LLM (optional) | Provider-agnostic, controlled by env vars | Disabled by default |
| Tests | `pytest` (backend, scenario validation), `node --test` (engine and matcher) | No browser test framework required |

Do not add npm dependencies. Do not add a CSS framework.

---

## 5. Repository layout

```
scam-gym/
├── README.md
├── SPEC.md                      (this file)
├── .env.example
├── requirements.txt
├── backend/
│   ├── main.py                  FastAPI app, static mount, routes
│   ├── config.py                env settings
│   ├── schemas.py               Pydantic models
│   ├── db.py                    SQLite helpers
│   ├── rephrase.py              LLM wrapper + validators + fallback
│   ├── study.py                 study endpoints logic
│   └── tests/
│       ├── test_api.py
│       ├── test_rephrase.py
│       └── test_scenarios.py    validates scenarios.json
├── frontend/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── css/styles.css
│   ├── js/
│   │   ├── app.js               router + screen rendering
│   │   ├── engine.js            drill state machine (pure)
│   │   ├── matcher.js           reply-to-choice matching (pure)
│   │   ├── voice.js             speech in/out wrapper
│   │   ├── debrief.js           builds debrief from run history
│   │   ├── study.js             pre/post test flow
│   │   └── api.js               fetch wrappers with timeout + fallback
│   ├── data/
│   │   ├── scenarios.json
│   │   └── study_items.json
│   └── tests/
│       ├── engine.test.mjs
│       └── matcher.test.mjs
└── scripts/
    └── export_study_csv.py
```

---

## 6. Data model

### 6.1 `scenarios.json`

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "bank-call",
      "title": "The bank security call",
      "blurb": "A caller says your account is about to be blocked.",
      "audience": "everyone",
      "caller": { "name": "Mr. Adebayo", "role": "Kestrel Bank security unit", "voice": "male" },
      "start": "n1",
      "nodes": {
        "n1": {
          "say": "Good afternoon. This is Mr. Adebayo from Kestrel Bank security. Your account has been flagged and your BVN will be deactivated within one hour. I need to confirm your date of birth.",
          "tactics": ["authority", "deadline", "fear"],
          "choices": [
            { "id": "c1", "label": "Give my date of birth", "type": "risky", "to": "n2",
              "keywords": ["birthday", "born", "date of birth", "my dob", "nineteen", "ok sure"] },
            { "id": "c2", "label": "Ask why they are calling", "type": "stall", "to": "n3",
              "keywords": ["why", "who is this", "what is this", "what do you want", "who are you"] },
            { "id": "c3", "label": "Hang up and call the number on my card", "type": "safe", "to": "end_safe_bank",
              "keywords": ["hang up", "call back", "call you back", "number on my card", "call the bank", "i will verify", "bye"] }
          ]
        }
      },
      "ends": {
        "end_safe_bank": { "result": "safe", "headline": "You hung up and verified.", "habit": "A real bank will never ask for your code. Hang up and call the number on your card." },
        "end_lost_bank": { "result": "lost", "headline": "This is where the money would be gone.", "habit": "Never read out a code or PIN to anyone who called you." }
      }
    }
  ]
}
```

**Field rules**
- `type` is one of `safe`, `risky`, `stall`.
- `safe` choices must point to an end with `result: "safe"`.
- `risky` choices must point to an end with `result: "lost"` or to a node that eventually forces a choice.
- `stall` choices must point to another node (never an end), and the next node must have higher pressure (more tactics).
- Every node has 2 to 4 choices, at least one `safe`. Max depth 5 nodes per scenario.
- `tactics` values come from this fixed list (also used by the debrief): `authority`, `deadline`, `fear`, `fake_proof`, `secrecy`, `isolation`, `emotion`, `rush`, `fake_alert`.
- `keywords` are lowercase phrases for voice matching (Section 8).

### 6.2 Tactic glossary (embedded in `scenarios.json` as `tactics_glossary`)

| id | Name | Plain explanation | Safer reply |
|---|---|---|---|
| authority | Pretending to be official | Scammers claim to be a bank, an agency or a boss so you do not question them. | Say you will call back on a number you already have. |
| deadline | Artificial deadline | A short countdown stops you from thinking or asking anyone. | Real problems can wait five minutes. Slow down. |
| fear | Fear of loss or arrest | Threats make you act before you verify. | Hang up, then check through the official channel. |
| fake_proof | Fake proof | They quote a detail, send a message that looks real, or show a screenshot. | Details can be stolen. Verify independently. |
| secrecy | "Do not tell anyone" | Secrecy blocks the person who would spot the scam. | Tell someone you trust right away. |
| isolation | "Stay on the line" | Keeping you on the call stops you from checking. | Ending the call is always allowed. |
| emotion | Emotional pressure | A crying or panicked voice, even a familiar one, switches off careful thinking. | Use a family code word or call their real number. |
| rush | Rush | "My bus is leaving" turns delay into an insult. | A real customer can wait for confirmation. |
| fake_alert | Fake alert | A message that looks like a bank credit alert is not proof of money. | Check your own banking app balance. |

### 6.3 `study_items.json`

Two item sets (`A` and `B`) of 5 items each, plus a `correct` field of `verify`. Each item is `{ "id", "set", "text", "options": [{"id":"comply","label":"..."},{"id":"verify","label":"..."}] }`. Sets are randomized per participant (pre = A, post = B, or reversed) so the same person never sees the same items twice. Suggested items (all fictional):

- Set A: (1) text asking to confirm a code for a blocked account; (2) voice-note "mum, send money now"; (3) delivery fee link; (4) transfer alert shown by a customer at a POS point; (5) caller claiming to be from a law-enforcement agency demanding a fine.
- Set B: (1) caller says BVN deactivation; (2) message from a "sibling" on a new number asking for urgent airtime or funds; (3) prize notification asking for a fee; (4) overpayment refund request; (5) "bank agent" asking you to move money to a "safe account".

---

## 7. Drill engine (`engine.js`, pure functions, no DOM)

```js
// State
{ scenarioId, nodeId, history: [{nodeId, choiceId, type}], tacticsSeen: Set, status: "running"|"safe"|"lost" }

createRun(scenarios, scenarioId) -> state
getNode(state) -> { say, choices, tactics }
choose(state, choiceId) -> newState   // immutable update; adds tactics; resolves ends
isEnd(state) -> boolean
```

Rules:
- Tactics of each visited node are added to `tacticsSeen`.
- Choosing a choice whose `to` is in `ends` sets `status` to `safe` or `lost`.
- Throw a typed error if `choiceId` is invalid. The UI must never crash on it.
- No randomness in the engine. The same inputs always give the same result.

---

## 8. Reply matcher (`matcher.js`)

Purpose: map a spoken or typed sentence to one of the node's choices.

Algorithm:
1. Normalize: lowercase, strip punctuation, collapse spaces. Basic Nigerian English tolerance: treat "abeg", "oga" and filler words as stop words.
2. For each choice, count matched keyword phrases (substring match on the normalized text). A multi-word phrase scores 2, a single word scores 1.
3. Add global intent boosts: phrases like "hang up", "i will call", "call you back", "no i will not", "not giving" always boost `safe` choices by 2. Phrases like "here is the code", "my pin is", "ok sending", "i have sent" boost `risky` choices by 2.
4. Return `{ choiceId, confidence }` where `confidence = bestScore / (bestScore + secondBestScore + 1)`.
5. If `bestScore < 2` or `confidence < 0.55`, return `null`. The UI then says "I did not catch that. Tap one of the options." and never guesses.

Never auto-select a `risky` choice at low confidence. Prefer `null`.

---

## 9. Voice layer (`voice.js`)

- Voice is **off by default**. The start screen has a toggle "Use voice (optional)" with this note: "Voice uses your browser's speech feature. Some browsers send speech to their provider to convert it to text. Turn voice off to avoid this. Nothing is recorded or stored by Scam Gym."
- `speak(text, voiceHint)`: uses `speechSynthesis`, picks an English voice whose `lang` starts with `en`, prefers `en-NG` or `en-GB` if present. Male or female hint adjusts pitch slightly. Cancels any previous utterance first.
- `listen()`: returns a Promise of the transcript, 8 second timeout, handles `no-speech`, `not-allowed`, `network` errors by resolving `null` and showing the tap fallback message. Never throws to the UI.
- Captions: the caller's text is always shown on screen, with or without audio.
- If either API is unsupported, hide the voice toggle and run in tap mode with no error message.

---

## 10. Frontend screens

Single-page, hash-based routing (`#/`, `#/drill/:id`, `#/debrief`, `#/family-code`, `#/study`, `#/about`).

1. **Home (`#/`)**
   - Heading: "Practice the scam call before it happens."
   - Safety notice (visible, not collapsible): "Everything here is fictional. Never type real names, numbers, codes or PINs. Nothing you do here is stored."
   - Voice toggle.
   - Three drill cards (title, one-line blurb, "Start the call" button).
   - Links: "How this works", "Take the before-and-after study".
2. **Call screen (`#/drill/:id`)**
   - Phone-call layout: caller name and role, a "call timer", pressure indicator (0 to 4 steps rising with tactics seen).
   - Caption box with the caller's line (`aria-live="polite"`).
   - Three reply buttons (large, full width). A mic button appears if voice is on.
   - "End call" button always visible: it is always a safe exit and routes to the safe debrief. (This teaches that ending a call is always allowed.)
3. **Result and debrief (`#/debrief`)**
   - Result headline (from the end node) with an icon and text, not colour alone.
   - "What the caller did" list: each tactic seen with its glossary name, plain explanation and safer reply.
   - "Your path" list: each choice made, tagged safe, risky or stall.
   - Habit card (one sentence, large).
   - Buttons: "Try again", "Try another drill", and for the cloned-voice drill, "Set a family code word".
   - Collapsible "If this happened for real": call your bank using the number on your card, do not send more money, keep screenshots, report to the EFCC (efcc.gov.ng) or the police.
4. **Family code word (`#/family-code`)**
   - Explains the idea in three sentences.
   - Input for a word or phrase (kept in memory only, never stored or sent).
   - "Copy message for family" button producing: "Our family code word is [word]. If anyone calls asking for money, ask for it. If they cannot say it, hang up and call me on my normal number."
   - Safety note: do not share the word in public groups.
5. **Study (`#/study`)**: see Section 12.
6. **About (`#/about`)**: what it is, what it cannot do, credits (Section 15), and the limitation statement.

**Accessibility requirements**
- Base font size 18px or larger, buttons at least 48px tall.
- Full keyboard use, visible focus ring, logical tab order.
- `aria-live` on the caption box and result headline.
- Respect `prefers-reduced-motion` (no animations when set).
- Colour contrast at least WCAG AA, light and dark themes via `prefers-color-scheme`.
- Meaning never carried by colour alone.
- Works at 360px width.

**Visual direction:** calm, serious, not playful. Large type, one accent colour for "safe", a distinct warm colour for "risky", neutral surfaces. No stock illustrations, no gradient washes, no emoji as the only icon.

---

## 11. The three drills (full scripts)

All names, banks and amounts are fictional. Amounts are in naira. Each script below must be encoded into `scenarios.json` following Section 6.1. Add an "End call" safe exit on every node (handled by the UI, not in JSON).

### Drill 1: `bank-call` (The bank security call)
Caller: Mr. Adebayo, Kestrel Bank security unit.

- **n1** (authority, deadline, fear): "Good afternoon. This is Mr. Adebayo from Kestrel Bank security. Your account has been flagged and your BVN will be deactivated within one hour. I need to confirm your date of birth."
  - Give date of birth (risky) → n2
  - Ask why they are calling (stall) → n3
  - Hang up and call the number on my card (safe) → end_safe
- **n2** (fake_proof, fear): "Thank you. I can see your balance is about ₦180,000. Someone just tried to move ₦250,000. A code was just sent to you. Read it to me so I can block it."
  - Read out the code (risky) → end_lost
  - Say banks never ask for codes and hang up (safe) → end_safe
  - Ask for his staff ID (stall) → n3
- **n3** (isolation, deadline): "There is no time, madam or sir. My staff ID is KB-4471. Do not end this call or they will empty the account. Read me the code now."
  - Read out the code (risky) → end_lost
  - Hang up and call the bank on my own (safe) → end_safe
- **end_safe**: "You hung up and verified." Habit: "A real bank never asks for your code. Hang up and call the number on your card."
- **end_lost**: "This is where the money would be gone." Habit: "Never read out a code or PIN to anyone who called you."

### Drill 2: `family-voice` (It's me, I'm in trouble)
Caller: a voice that sounds like a relative ("Chidi"). This is a simulated cloned voice, labelled as such on screen.

- **n1** (emotion, secrecy, rush): "Mum, it's me. I had an accident. My phone is broken, I'm using someone's phone. Please send ₦150,000 to this account now. Don't tell Daddy."
  - Send the money (risky) → end_lost
  - Ask for our family code word (safe) → n2
  - Hang up and call Chidi's real number (safe) → end_safe
- **n2** (emotion, rush, fear): "Mum, please, I can't remember that, I'm hurt! The hospital won't treat me until I pay. Why are you wasting time?"
  - Send the money to help (risky) → end_lost
  - Hang up and call Chidi's real number (safe) → end_safe
  - Ask where he is (stall) → n3
- **n3** (isolation, secrecy): "I can't say. Just send it now and stay on the phone. Please, Mum, don't call anyone."
  - Send the money (risky) → end_lost
  - Hang up and call Chidi's real number (safe) → end_safe
- **end_safe**: "You verified before sending." Habit: "A familiar voice is not proof. Use a family code word, or hang up and call their real number."
- **end_lost**: "This is where the money would be gone." Habit: "Voices can be copied from a few seconds of audio. Always verify."

### Drill 3: `pos-alert` (The fake transfer alert, for POS agents)
Caller: a customer standing at the agent's counter.

- **n1** (fake_alert, rush): "Abeg, I just sent ₦40,000 to your account. Check your phone, the alert is there. I need the cash now, my bus is leaving."
  - Hand over the cash (risky) → end_lost
  - Check my banking app, not the SMS (safe) → n2
  - Ask him to wait (stall) → n3
- **n2** (rush, fake_proof): "See the message na! Why you dey delay me? Everybody does it like this." Screen shows a fictional alert styled message from an unknown sender.
  - Hand over the cash (risky) → end_lost
  - Wait until my own app shows the money (safe) → end_safe
- **n3** (rush, fake_alert): "Oga, look at the message again. The money is there. I will be late. Give me the cash."
  - Hand over the cash (risky) → end_lost
  - Check my own banking app first (safe) → end_safe
- **end_safe**: "You checked your own balance." Habit: "A message is not money. Only your own banking app confirms a transfer."
- **end_lost**: "This is where the cash would be gone." Habit: "Fake alerts look real. Confirm in your own banking app before handing over cash."

Optional 4th drill (`agency-threat`, only if time allows): a caller claiming to be from a law-enforcement agency threatens arrest and demands a "fine". Same structure, safe exit is to hang up and verify through the agency's official office.

---

## 12. Before-and-after study (evidence for judging)

Purpose: produce a small, honest, measured outcome. Fully optional for any user.

Flow (`#/study`):
1. **Consent screen:** "This is a short anonymous study for a hackathon project. We record only your answers and a random ID. No names or contact details. You can stop at any time." Checkbox + "Start".
2. **Pre-test:** 5 items (one set) shown as text. Per item: "What would you do?" with two options, `comply` or `verify`.
3. **Drill:** the participant plays any two drills.
4. **Post-test:** 5 different items (other set).
5. **Thank-you:** shows their own score and the habit card.

The frontend keeps a random UUID in memory only. On completion it posts the result. If the backend is unavailable the result is not stored and the user is told "Your results could not be saved, but you can still keep going."

### Summary endpoint output
`pre_verify_rate`, `post_verify_rate`, `n`, `change_points`, plus per-item rates. The About page and the demo chart read from this. The summary must show `n` and the label "small sample, self-reported".

---

## 13. Backend API

All responses are JSON. Add CORS only for same origin (no wildcard). Rate limit write endpoints to 30 requests per minute per IP using a simple in-memory limiter.

### `GET /api/health`
`200 {"status":"ok","llm_enabled":false}`

### `GET /api/scenarios`
Returns the same content as `frontend/data/scenarios.json`.

### `POST /api/rephrase` (optional)
Request: `{"scenario_id": "bank-call", "node_id": "n1"}`.
Response: `{"say": "<varied wording>", "source": "llm" | "fallback"}`.

Rules (in `rephrase.py`):
- Disabled unless `LLM_ENABLED=true` and a provider key is set. If disabled, return the original `say` with `source: "fallback"`.
- The server loads the original line from its own copy of `scenarios.json`. The client never sends the text to rephrase.
- The prompt instructs the model to keep the meaning, tone, tactics and length (max +20 percent), keep all names, amounts and the fake bank name unchanged, and output only the line.
- **Validators** (all must pass, otherwise fallback): length within bounds; contains every number and name from the original; contains no URL, no phone number, no email; does not introduce a new request for real information; contains none of a blocked-term list (real bank and telecom names, real agency names other than those in the original).
- Timeout 2 seconds. Any error returns the fallback. Cache results in memory by `(scenario_id, node_id)`.

### `POST /api/study/session`
Body:
```json
{ "participant_id": "uuid4", "pre_set": "A", "post_set": "B",
  "pre": [{"item_id":"A1","answer":"comply"}],
  "post": [{"item_id":"B1","answer":"verify"}],
  "drills_played": ["bank-call","pos-alert"],
  "consent": true }
```
Validation: `consent` must be true; each answer list has exactly 5 items; answers are `comply` or `verify`; `participant_id` is a UUID; reject any extra free-text field. Respond `201 {"stored": true}`. Ignore duplicate `participant_id`.

### `GET /api/study/summary`
Response:
```json
{ "n": 9, "pre_verify_rate": 0.44, "post_verify_rate": 0.82,
  "change_points": 38, "per_item": [{"item_id":"A1","verify_rate":0.5}],
  "label": "Small sample, self-reported" }
```
Return zeros and `n: 0` when empty.

### Database schema (SQLite)
```sql
CREATE TABLE study_sessions (
  participant_id TEXT PRIMARY KEY,
  pre_set TEXT, post_set TEXT,
  pre_json TEXT, post_json TEXT,
  drills_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```
No IP addresses, no user agents, no names stored.

### Static files
Mount `/frontend` at `/`. Serve `index.html` for unknown non-API routes.

---

## 14. Security and privacy requirements

- No cookies. No third-party requests from the frontend (no CDNs, no analytics, no web fonts from external hosts; use system fonts or self-hosted).
- Set headers: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Escape all text inserted into the DOM (use `textContent`, never `innerHTML` with dynamic data).
- Secrets only from environment variables. `.env` is git-ignored. Provide `.env.example`.
- Never log request bodies for study endpoints.
- The family code word never leaves the browser.

---

## 15. Credits and pre-existing work (shown on About page and in README)

Include a "Credits" section listing: browser Web Speech APIs, FastAPI, Uvicorn, Pydantic, and any LLM provider used. State: "Built during Oct 17 to Nov 22, 2026 with AI coding assistance (Claude Code)." Also state (Addendum A): "Spanish and French text was drafted with AI assistance and has not been reviewed by a native speaker yet." Add a "Pre-existing components" line that reads "None" unless code from an earlier project is actually reused. If any is reused, name it and list what it was used for. Scenario scripts, UI and tests must be written inside the build window.

**Limitation statement (About page, README, Devpost):** "Scam Gym builds a habit through simulated practice. It cannot detect or stop real scams, and a real caller with a spoofed number or detailed personal information may be more convincing than any drill."

---

## 16. Testing and quality gates

**Scenario validator (`test_scenarios.py`, also run in CI or by hand):**
- Every node reachable from `start`; no unreachable nodes or ends.
- Every choice's `to` exists; every node has 2 to 4 choices and at least one `safe`.
- No `stall` choice points to an end; no cycles.
- All `tactics` values are in the glossary.
- No real brand names (maintain `BLOCKED_NAMES` list in the test).
- Every end has `headline` and `habit`.

**Engine tests:** each scenario, taking only safe choices, ends `safe`; taking the first risky choice ends `lost`; invalid choice id throws; tactics accumulate.

**Matcher tests:** at least 6 phrases per scenario per choice, including Nigerian English variants; ambiguous input returns `null`; a risky phrase never auto-selects at low confidence.

**Backend tests:** health; scenarios; rephrase disabled returns fallback; rephrase validator rejects URL, phone number, changed amount; study validation rejects missing consent, wrong item counts, free text; summary math on a seeded database.

**Manual QA checklist:**
- Complete each drill by tapping only, with the microphone blocked.
- Complete each drill with voice on, in a noisy and a quiet room.
- Disable the network after first load and confirm drills still work.
- Test at 360px width, in dark mode, and with keyboard only.
- Test with a screen reader on the call screen (caption announced once per line).

**Definition of done:** all tests pass; the three drills complete in tap mode with no backend running; Lighthouse accessibility score of 90 or higher on Home and Call screens; no console errors.

---

## 17. Build order for Claude Code

1. Scaffold the repo, `requirements.txt`, `.env.example`, and a README stub.
2. Write `scenarios.json` (Section 11) and the validator test. Do not continue until it passes.
3. Build `engine.js` and its tests.
4. Build `matcher.js` and its tests.
5. Build the static frontend: Home, Call, Debrief, Family code, About, in tap mode only. Test fully.
6. Add `voice.js` and wire the optional voice toggle with all fallbacks.
7. Add the PWA manifest and service worker (cache shell and scenarios).
8. Build the FastAPI backend: health, scenarios, static mount, security headers.
9. Add the study flow (frontend and backend) and the summary endpoint.
10. Add `rephrase.py` (optional) with validators, disabled by default.
11. Polish accessibility, run the full test list, write the README with run instructions.

**Run instructions to include in the README:**
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000
```

**Environment variables (`.env.example`):**
```
LLM_ENABLED=false
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=
DATABASE_PATH=./study.db
```

---

## 18. Devpost mapping (for the final write-up)

- **Safety Benefit:** one user, one skill, measured before-and-after result (Section 12).
- **Practical Functionality:** deterministic branching drills with a tap-only fallback; works offline.
- **Trust and Responsible Design:** fictional data, no accounts, opt-in voice with a plain disclosure, validators on any AI-written text, honest limitation statement.
- **Clarity and User Experience:** large type, one-tap start, captions, plain-language debrief.
- **Required items:** one safer-outcome example (a participant who chose `comply` in the pre-test and `verify` in the post-test), one limitation (Section 15), AI assistance credit (Section 15), source link, demo link or video, screenshots.
