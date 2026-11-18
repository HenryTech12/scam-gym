// Builds the debrief from a finished run. Pure, no DOM.

export function buildDebrief(state, glossary, endedCallLabel = "Ended the call") {
  const scenario = state.scenario;
  const end = scenario.ends[state.endId];
  const tactics = [...state.tacticsSeen].map((id) => ({
    id,
    name: glossary[id]?.name ?? id,
    explanation: glossary[id]?.explanation ?? "",
    safer: glossary[id]?.safer ?? "",
  }));
  const path = state.history.map((step) => {
    const node = scenario.nodes[step.nodeId];
    const choice = node.choices.find((c) => c.id === step.choiceId);
    return {
      label: choice ? choice.label : endedCallLabel,
      type: step.type,
      callerSaid: node.say,
    };
  });
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    result: end.result,
    headline: end.headline,
    habit: end.habit,
    tactics,
    path,
    offerFamilyCode: Boolean(scenario.offer_family_code),
  };
}
