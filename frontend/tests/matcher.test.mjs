import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { match, normalize, scoreChoices } from "../js/matcher.js";

const data = JSON.parse(readFileSync(new URL("../data/scenarios.json", import.meta.url), "utf8"));
const node = (sid, nid) => data.scenarios.find((s) => s.id === sid).nodes[nid];

// [scenario, node, choiceId, phrases]. At least 6 per choice, including Nigerian English.
const CASES = [
  ["bank-call", "n1", "c1", [
    "My date of birth is the fifth of May",
    "I was born on 12 March 1985",
    "Okay sure, it's nineteen eighty",
    "Ehn, my birthday is 3rd of June",
    "Oga no wahala, I was born in July",
    "my dob is 4 april",
  ]],
  ["bank-call", "n1", "c2", [
    "Why are you calling me?",
    "Who is this please?",
    "Sorry, who are you?",
    "Wetin happen to my account?",
    "What is happening with my account?",
    "Flagged for what? Tell me why",
    "Who be this?",
  ]],
  ["bank-call", "n1", "c3", [
    "I will hang up and call the bank",
    "Let me call the number on my card",
    "I'll call you back",
    "Abeg, I will verify with the bank myself. Bye",
    "I will go to the bank tomorrow",
    "No I will not, I will call back",
  ]],
  ["bank-call", "n2", "c1", [
    "The code is 4 8 2 9 1 7",
    "Okay here is the code",
    "Ehn, I see the code, it says 551203",
    "I have the code now",
    "Ok I will read it to you",
    "Let me read it, the code says 7711",
  ]],
  ["bank-call", "n2", "c2", [
    "Banks never ask for codes, I'm hanging up. Bye",
    "My bank never asks for that. I will hang up",
    "This is a scam, I am not giving you anything",
    "You be scammer, 419! Bye",
    "I will call the bank with the number on my card",
    "I know this trick. Hang up.",
  ]],
  ["bank-call", "n2", "c3", [
    "What is your staff ID?",
    "Give me your staff number first",
    "Prove it, what is your ID number?",
    "Which branch are you from? Your full name?",
    "Oga, show me your badge, prove it",
    "Tell me your staff id",
  ]],
  ["bank-call", "n3", "c1", [
    "Okay okay, the code is 3 3 9 1 0 2",
    "Here is the code",
    "Alright, I have the code",
    "Abeg take the code, it says 884210",
    "Ok I will read it to you now",
    "I see the code",
  ]],
  ["bank-call", "n3", "c2", [
    "I'm going to hang up and call the bank",
    "I will call the bank on my own",
    "I'll go to the bank myself",
    "You are a scammer, bye",
    "I will verify with the number on my card",
    "Abeg I will call back",
  ]],
  ["family-voice", "n1", "c1", [
    "Okay I am sending it now",
    "I will send the money, what account?",
    "Give me the account number",
    "Ok my son, I'm sending it",
    "Ok sending",
    "I will transfer it now",
  ]],
  ["family-voice", "n1", "c2", [
    "What is our family code word?",
    "Tell me the code word first",
    "Say the word, our secret word",
    "Prove it is you, what's our password?",
    "If it is you, tell me our code",
    "Biko, what is our family code?",
  ]],
  ["family-voice", "n1", "c3", [
    "I'll hang up and call your real number",
    "Let me call Chidi on his normal number",
    "I will call you back on your number",
    "I'm going to call your phone",
    "Hang up, I will call you",
    "Let me call him. Bye",
  ]],
  ["family-voice", "n2", "c1", [
    "Okay I will send it",
    "I'm sending the money now",
    "I will pay the hospital",
    "Give me the account number, I will help you",
    "Ok my dear, I have sent it",
    "I am sending it now",
  ]],
  ["family-voice", "n2", "c2", [
    "I'll hang up and call your real number",
    "Let me call Chidi",
    "I will call you back on your normal number",
    "I'm going to hang up now",
    "I will call your phone",
    "Let me call him first",
  ]],
  ["family-voice", "n2", "c3", [
    "Where are you?",
    "Which hospital are you in?",
    "Tell me where you are",
    "Where you dey?",
    "What is the name of the hospital?",
    "What is the address?",
  ]],
  ["family-voice", "n3", "c1", [
    "Okay I am sending it",
    "I will send it now",
    "Ok my son, I'm sending",
    "I have sent it",
    "Give me the account number",
    "I will transfer it",
  ]],
  ["family-voice", "n3", "c2", [
    "I will hang up and call your real number",
    "I'm going to call Chidi",
    "Let me call your father",
    "I'll call you back",
    "I will call your phone now. Bye",
    "Hang up, I am calling Daddy",
  ]],
  ["pos-alert", "n1", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go, count it",
    "Ok take the cash",
    "Come and collect it",
    "Let me give you the money, here you go",
  ]],
  ["pos-alert", "n1", "c2", [
    "Let me check my app first",
    "I will check my banking app, not the SMS",
    "I need to check my balance",
    "The message is not enough, let me check my account",
    "Abeg let me confirm on the app",
    "I will check my bank app",
  ]],
  ["pos-alert", "n1", "c3", [
    "Please wait",
    "Hold on, give me a minute",
    "Oga, wait small",
    "Exercise patience",
    "Calm down, no rush",
    "Relax, take it easy",
  ]],
  ["pos-alert", "n2", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go",
    "Ok take the cash",
    "Let me give you your money",
    "Here is your money, count it",
  ]],
  ["pos-alert", "n2", "c2", [
    "I will wait until my app shows it",
    "Not until it enters my own app",
    "Wait until I see it in my balance",
    "When it shows in my banking app I will pay",
    "I will check my app",
    "Until I see it on my own app, no cash",
  ]],
  ["pos-alert", "n3", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go",
    "Ok take the cash",
    "Let me give you the money",
    "Here is your money",
  ]],
  ["pos-alert", "n3", "c2", [
    "Let me check my banking app first",
    "I will check my own app",
    "Let me check my balance first",
    "I need to confirm on the app",
    "Abeg I will check my account",
    "First, I will check my bank app",
  ]],
];

for (const [sid, nid, cid, phrases] of CASES) {
  test(`${sid}/${nid}/${cid}: ${phrases.length} phrases match`, () => {
    assert.ok(phrases.length >= 6);
    const choices = node(sid, nid).choices;
    for (const p of phrases) {
      const res = match(p, choices);
      assert.ok(res, `no match for "${p}" (scores ${JSON.stringify(scoreChoices(p, choices).map((s) => [s.choice.id, s.score]))})`);
      assert.equal(res.choiceId, cid, `"${p}" matched ${res.choiceId}`);
      assert.ok(res.confidence >= 0.55);
    }
  });
}

test("every choice in every node is covered by the cases", () => {
  for (const s of data.scenarios) {
    for (const [nid, n] of Object.entries(s.nodes)) {
      for (const c of n.choices) {
        assert.ok(CASES.some(([a, b, d]) => a === s.id && b === nid && d === c.id), `${s.id}/${nid}/${c.id} not covered`);
      }
    }
  }
});

test("ambiguous or unrelated input returns null", () => {
  const n1 = node("bank-call", "n1").choices;
  for (const p of ["", "hmm", "okay", "I am in the market", "what", "abeg oga", "yes"]) {
    assert.equal(match(p, n1), null, `"${p}" should be null`);
  }
  // Mentions two options equally: never guess.
  assert.equal(match("born why", n1), null);
  assert.equal(match("send", node("family-voice", "n1").choices), null);
  assert.equal(match("wait", node("pos-alert", "n1").choices), null);
});

test("a risky phrase never auto-selects at low confidence or with negation", () => {
  const n2 = node("bank-call", "n2").choices;
  assert.equal(match("I will not read the code is what I mean", n2), null);
  assert.equal(match("I don't have the code", n2), null);
  assert.equal(match("I'm not sending anything", node("family-voice", "n1").choices)?.choiceId ?? null, null);
  assert.equal(match("I won't give you my date of birth", node("bank-call", "n1").choices), null);
  const pos = node("pos-alert", "n1").choices;
  assert.equal(match("I'm not going to hand over the cash", pos), null);
  // A risky choice is never returned when its score ties a safe one.
  assert.equal(match("here you go, let me check", pos), null);
});

test("normalize strips punctuation, case and Nigerian filler words", () => {
  assert.equal(normalize("  Abeg, OGA!! I'll   call you back... "), "ill call you back");
  assert.equal(normalize("Ehn... wetin happen sha?"), "wetin happen");
});
