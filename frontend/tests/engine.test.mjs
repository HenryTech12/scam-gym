import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRun, getNode, getEnd, choose, endCall, isEnd, pressure, DrillError } from "../js/engine.js";

const load = (lang) => JSON.parse(readFileSync(new URL(`../data/scenarios.${lang}.json`, import.meta.url), "utf8"));
const data = load("en");
const ids = data.scenarios.map((s) => s.id);

function playBy(state, pick) {
  let steps = 0;
  while (!isEnd(state)) {
    const choice = pick(getNode(state).choices);
    assert.ok(choice, `no matching choice at ${state.nodeId}`);
    state = choose(state, choice.id);
    assert.ok(++steps <= 5, "run should end within 5 choices");
  }
  return state;
}

for (const id of ids) {
  test(`${id}: taking only safe choices ends safe`, () => {
    const end = playBy(createRun(data, id), (cs) => cs.find((c) => c.type === "safe"));
    assert.equal(end.status, "safe");
    assert.equal(getEnd(end).result, "safe");
    assert.ok(end.history.every((h) => h.type === "safe"));
  });

  test(`${id}: taking the first risky choice ends lost`, () => {
    const end = playBy(createRun(data, id), (cs) => cs.find((c) => c.type === "risky"));
    assert.equal(end.status, "lost");
    assert.equal(getEnd(end).result, "lost");
  });

  test(`${id}: every stall path still ends`, () => {
    const end = playBy(createRun(data, id), (cs) => cs.find((c) => c.type === "stall") || cs.find((c) => c.type === "safe"));
    assert.equal(end.status, "safe");
  });

  test(`${id}: end call is always a safe exit`, () => {
    const end = endCall(createRun(data, id));
    assert.equal(end.status, "safe");
    assert.equal(getEnd(end).result, "safe");
    assert.equal(end.history.at(-1).choiceId, "end_call");
  });

  test(`${id}: invalid choice id throws a typed error`, () => {
    const run = createRun(data, id);
    assert.throws(() => choose(run, "nope"), (err) => err instanceof DrillError && err.code === "invalid_choice");
  });
}

test("tactics accumulate across nodes", () => {
  let s = createRun(data, "bank-call");
  assert.deepEqual([...s.tacticsSeen], ["authority", "deadline", "fear"]);
  s = choose(s, "c1"); // -> n2 (fake_proof, fear)
  assert.deepEqual([...s.tacticsSeen], ["authority", "deadline", "fear", "fake_proof"]);
  s = choose(s, "c3"); // -> n3 (isolation, ...)
  assert.ok(s.tacticsSeen.has("isolation"));
  assert.equal(pressure(s), 4);
});

test("choose is immutable and deterministic", () => {
  const a = createRun(data, "pos-alert");
  const b = choose(a, "c3");
  assert.equal(a.nodeId, "n1");
  assert.equal(a.history.length, 0);
  assert.equal(a.tacticsSeen.has("deadline"), false);
  assert.equal(b.nodeId, "n3");
  assert.deepEqual(choose(createRun(data, "pos-alert"), "c3").history, b.history);
  assert.ok(Object.isFrozen(b));
});

test("cannot choose after the run has ended", () => {
  const end = choose(createRun(data, "family-voice"), "c1");
  assert.equal(end.status, "lost");
  assert.equal(getNode(end), null);
  assert.throws(() => choose(end, "c1"), (err) => err.code === "run_finished");
  assert.throws(() => endCall(end), (err) => err.code === "run_finished");
});

test("unknown scenario throws a typed error", () => {
  assert.throws(() => createRun(data, "missing"), (err) => err instanceof DrillError && err.code === "unknown_scenario");
});

test("safe choice can lead to a node (family code word) and still end safe", () => {
  let s = createRun(data, "family-voice");
  s = choose(s, "c2");
  assert.equal(s.status, "running");
  assert.equal(s.nodeId, "n2");
  s = choose(s, "c2");
  assert.equal(s.status, "safe");
});

for (const lang of ["en", "es", "fr"]) {
  const d = load(lang);
  for (const s of d.scenarios) {
    test(`${lang}/${s.id}: safe path ends safe, first risky path ends lost`, () => {
      const safe = playBy(createRun(d, s.id), (cs) => cs.find((c) => c.type === "safe"));
      assert.equal(safe.status, "safe");
      const lost = playBy(createRun(d, s.id), (cs) => cs.find((c) => c.type === "risky"));
      assert.equal(lost.status, "lost");
      assert.equal(getEnd(lost).result, "lost");
    });
  }
}
