// Drill engine: a pure, deterministic state machine. No DOM, no randomness.
//
// State shape:
// { scenarioId, nodeId, endId, history: [{nodeId, choiceId, type}],
//   tacticsSeen: Set, status: "running" | "safe" | "lost" }

export class DrillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DrillError";
    this.code = code; // "unknown_scenario" | "invalid_choice" | "run_finished"
  }
}

export const END_CALL_ID = "end_call";

function findScenario(scenarios, scenarioId) {
  const list = Array.isArray(scenarios) ? scenarios : scenarios?.scenarios;
  const scenario = (list || []).find((s) => s.id === scenarioId);
  if (!scenario) throw new DrillError("unknown_scenario", `Unknown scenario: ${scenarioId}`);
  return scenario;
}

function freeze(state) {
  Object.freeze(state.history);
  return Object.freeze(state);
}

function withTactics(seen, tactics) {
  const next = new Set(seen);
  for (const t of tactics || []) next.add(t);
  return next;
}

export function createRun(scenarios, scenarioId) {
  const scenario = findScenario(scenarios, scenarioId);
  const first = scenario.nodes[scenario.start];
  return freeze({
    scenario,
    scenarioId,
    nodeId: scenario.start,
    endId: null,
    history: [],
    tacticsSeen: withTactics(new Set(), first.tactics),
    status: "running",
  });
}

export function isEnd(state) {
  return state.status !== "running";
}

export function getNode(state) {
  if (isEnd(state)) return null;
  const node = state.scenario.nodes[state.nodeId];
  return { say: node.say, choices: node.choices, tactics: node.tactics, visual: node.visual || null };
}

export function getEnd(state) {
  return state.endId ? state.scenario.ends[state.endId] : null;
}

export function choose(state, choiceId) {
  if (isEnd(state)) throw new DrillError("run_finished", "This call has already ended.");
  const node = state.scenario.nodes[state.nodeId];
  const choice = node.choices.find((c) => c.id === choiceId);
  if (!choice) throw new DrillError("invalid_choice", `Invalid choice: ${choiceId}`);

  const history = [...state.history, { nodeId: state.nodeId, choiceId: choice.id, type: choice.type }];
  const end = state.scenario.ends[choice.to];
  if (end) {
    return freeze({ ...state, history, endId: choice.to, status: end.result });
  }
  const next = state.scenario.nodes[choice.to];
  return freeze({
    ...state,
    history,
    nodeId: choice.to,
    tacticsSeen: withTactics(state.tacticsSeen, next.tactics),
  });
}

// "End call" is always allowed and always safe. It resolves to the first safe end.
export function endCall(state) {
  if (isEnd(state)) throw new DrillError("run_finished", "This call has already ended.");
  const endId = Object.keys(state.scenario.ends).find((id) => state.scenario.ends[id].result === "safe");
  const history = [...state.history, { nodeId: state.nodeId, choiceId: END_CALL_ID, type: "safe" }];
  return freeze({ ...state, history, endId, status: "safe" });
}

// 0 to 4 steps, rising with the number of distinct tactics seen.
export function pressure(state) {
  return Math.min(4, state.tacticsSeen.size);
}
