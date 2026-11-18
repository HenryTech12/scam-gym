// Fetch wrappers. Every call has a 2 second timeout and resolves to null on any failure,
// so the drill never depends on the backend.

const TIMEOUT_MS = 2000;

async function request(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let healthPromise = null;
export function getHealth() {
  if (!healthPromise) healthPromise = request("api/health");
  return healthPromise;
}

export async function rephrase(scenarioId, nodeId) {
  const res = await request("api/rephrase", { method: "POST", body: { scenario_id: scenarioId, node_id: nodeId } });
  return res && typeof res.say === "string" && res.say.trim() ? res : null;
}

export async function postStudySession(payload) {
  const res = await request("api/study/session", { method: "POST", body: payload });
  return Boolean(res && res.stored);
}

export function getStudySummary() {
  return request("api/study/summary");
}
