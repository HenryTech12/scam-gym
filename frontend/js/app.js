// Router and screen rendering. The whole drill runs locally from the bundled scenarios.json.

import { h, icon, typeTag } from "./dom.js";
import { createRun, getNode, choose, endCall, isEnd, pressure, DrillError } from "./engine.js";
import { match } from "./matcher.js";
import { buildDebrief } from "./debrief.js";
import * as voice from "./voice.js";
import * as api from "./api.js";
import * as study from "./study.js";

const app = {
  data: null,
  voiceOn: false, // kept in memory only
  llmEnabled: false,
  lastDebrief: null,
  cleanups: [],
};

const main = document.getElementById("app");
const NOT_CAUGHT = "I did not catch that. Tap one of the options.";

// ---------- helpers ----------

function onCleanup(fn) {
  app.cleanups.push(fn);
}

function runCleanups() {
  while (app.cleanups.length) {
    try {
      app.cleanups.pop()();
    } catch {
      /* ignore */
    }
  }
  voice.cancel();
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function screen(title, ...children) {
  document.title = `${title} · Scam Gym`;
  const heading = h("h1", { tabindex: "-1", text: title });
  main.replaceChildren(heading, ...children.flat());
  return heading;
}

let firstRender = true;
// Move focus to the new screen's heading on navigation, but not on the first page load.
function focusHeading(el) {
  if (firstRender) {
    firstRender = false;
    return;
  }
  requestAnimationFrame(() => {
    el?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
}

function scenarioById(id) {
  return app.data.scenarios.find((s) => s.id === id);
}

function safetyNotice() {
  return h(
    "p",
    { class: "notice", role: "note" },
    icon("shield"),
    h("span", { text: "Everything here is fictional. Never type real names, numbers, codes or PINs. Nothing you do here is stored." })
  );
}

function drillCards(onStart) {
  return h(
    "ul",
    { class: "cards", role: "list" },
    app.data.scenarios.map((s) =>
      h(
        "li",
        { class: "card" },
        h("h3", { text: s.title }),
        h("p", { text: s.blurb }),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => onStart(s.id), "aria-label": `Start the call: ${s.title}` }, "Start the call")
      )
    )
  );
}

// ---------- Home ----------

function renderHome() {
  const heading = screen(
    "Practice the scam call before it happens.",
    h("p", { class: "lead", text: "Take a short, fictional scam call. Reply by tapping or by voice. Then see each pressure trick the caller used, and the safer reply." }),
    safetyNotice(),
    voiceToggle(),
    h("h2", { text: "Choose a drill" }),
    drillCards((id) => navigate(`#/drill/${id}`)),
    h(
      "ul",
      { class: "links", role: "list" },
      h("li", {}, h("a", { href: "#/about" }, "How this works")),
      h("li", {}, h("a", { href: "#/study" }, "Take the before-and-after study")),
      h("li", {}, h("a", { href: "#/family-code" }, "Set a family code word"))
    )
  );
  focusHeading(heading);
}

function voiceToggle() {
  if (!voice.isSupported()) return null; // tap mode only, no error message
  const id = "voice-toggle";
  const input = h("input", {
    type: "checkbox",
    id,
    checked: app.voiceOn,
    "aria-describedby": "voice-note",
    onchange: (e) => {
      app.voiceOn = e.target.checked;
    },
  });
  return h(
    "div",
    { class: "toggle" },
    h("div", { class: "toggle-row" }, input, h("label", { for: id, text: "Use voice (optional)" })),
    h("p", {
      id: "voice-note",
      class: "small",
      text: "Voice uses your browser's speech feature. Some browsers send speech to their provider to convert it to text. Turn voice off to avoid this. Nothing is recorded or stored by Scam Gym.",
    })
  );
}

// ---------- Call screen ----------

function renderDrill(id) {
  const scenario = scenarioById(id);
  if (!scenario) {
    const heading = screen("Drill not found", h("p", { text: "That drill does not exist." }), h("a", { href: "#/", class: "btn" }, "Back to drills"));
    return focusHeading(heading);
  }

  let state = createRun(app.data, id);
  let token = 0; // guards async work from a previous line
  const started = Date.now();

  const timer = h("span", { class: "timer", role: "timer", "aria-label": "Call time", text: "00:00" });
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  onCleanup(() => clearInterval(tick));

  const meterSegs = [0, 1, 2, 3].map(() => h("span", { class: "seg" }));
  const meterText = h("span", { class: "meter-text" });
  const meter = h("div", { class: "pressure" }, h("span", { class: "meter-label", text: "Pressure" }), h("span", { class: "segs", "aria-hidden": "true" }, meterSegs), meterText);

  const caption = h("p", { class: "caption-text", id: "caption", "aria-live": "polite" });
  const visualSlot = h("div");
  const replyHeading = h("h2", { class: "reply-heading", tabindex: "-1", text: "Your reply" });
  const replies = h("div", { class: "replies", role: "group", "aria-labelledby": "reply-heading" });
  replyHeading.id = "reply-heading";
  const status = h("p", { class: "status", role: "status" });
  const micSlot = h("div");

  const endBtn = h(
    "button",
    { class: "btn btn-end", type: "button", onclick: () => finish(endCall(state)) },
    icon("phoneOff"),
    "End call"
  );

  const avatarText = scenario.caller.name.replace(/[^A-Za-z ]/g, "").split(" ").filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 2).join("");

  document.title = `${scenario.title} · Scam Gym`;
  main.replaceChildren(
    h(
      "section",
      { class: "call", "aria-label": "Simulated call" },
      h("h1", { class: "visually-hidden", tabindex: "-1", id: "call-title", text: `Drill: ${scenario.title}` }),
      h(
        "div",
        { class: "call-head" },
        h("div", { class: "avatar", "aria-hidden": "true", text: avatarText || "?" }),
        h("div", { class: "who" }, h("p", { class: "caller-name", text: scenario.caller.name }), h("p", { class: "caller-role", text: scenario.caller.role })),
        h("div", { class: "call-meta" }, h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "visually-hidden", text: "Simulated call in progress. " }), timer)
      ),
      scenario.notice ? h("p", { class: "sim-label", text: scenario.notice }) : null,
      meter,
      h("div", { class: "caption" }, h("p", { class: "caption-label", text: "Caller says" }), caption),
      visualSlot,
      replyHeading,
      replies,
      micSlot,
      status,
      h("div", { class: "end-wrap" }, endBtn, h("p", { class: "small", text: "Ending a call is always allowed." }))
    )
  );
  focusHeading(document.getElementById("call-title"));

  function finish(endState) {
    runCleanups();
    app.lastDebrief = buildDebrief(endState, app.data.tactics_glossary);
    if (study.isActive()) study.recordDrill(endState.scenarioId);
    navigate("#/debrief");
  }

  function pick(choiceId) {
    try {
      const next = choose(state, choiceId);
      voice.cancel();
      if (isEnd(next)) return finish(next);
      state = next;
      showNode(true);
    } catch (err) {
      // An invalid choice must never crash the UI.
      status.textContent = err instanceof DrillError ? NOT_CAUGHT : "Something went wrong. Tap one of the options.";
    }
  }

  async function showNode(moveFocus) {
    const my = ++token;
    const node = getNode(state);
    const level = pressure(state);
    meterSegs.forEach((s, i) => s.classList.toggle("on", i < level));
    meterText.textContent = `${level} of 4`;
    status.textContent = "";

    let line = node.say;
    if (app.llmEnabled) {
      caption.classList.add("waiting");
      const res = await api.rephrase(state.scenarioId, state.nodeId);
      if (my !== token) return;
      caption.classList.remove("waiting");
      if (res?.say) line = res.say;
    }
    caption.textContent = line;

    visualSlot.replaceChildren(node.visual ? smsCard(node.visual) : "");

    replies.replaceChildren(
      ...node.choices.map((c) => h("button", { class: "btn btn-reply", type: "button", onclick: () => pick(c.id) }, c.label))
    );

    micSlot.replaceChildren();
    if (app.voiceOn && voice.isSupported()) {
      const mic = h("button", { class: "btn btn-mic", type: "button" }, icon("mic"), "Say your reply");
      mic.addEventListener("click", async () => {
        mic.disabled = true;
        status.textContent = "Listening. Speak now.";
        const { transcript } = await voice.listen();
        if (my !== token) return;
        mic.disabled = false;
        if (!transcript) {
          status.textContent = NOT_CAUGHT;
          return;
        }
        const result = match(transcript, node.choices);
        if (!result) {
          status.textContent = `You said: "${transcript}". ${NOT_CAUGHT}`;
          return;
        }
        pick(result.choiceId);
      });
      micSlot.append(mic);
      voice.speak(line, scenario.caller.voice);
    }

    if (moveFocus) replyHeading.focus();
  }

  showNode(false);
}

function smsCard(visual) {
  return h(
    "figure",
    { class: "sms" },
    h("p", { class: "sms-from" }, icon("message", "icon icon-sm"), h("span", { text: `Message shown by the customer. From: ${visual.sender}` })),
    h("blockquote", { class: "sms-body", text: visual.text }),
    h("figcaption", { class: "small", text: visual.note })
  );
}

// ---------- Debrief ----------

function renderDebrief() {
  const d = app.lastDebrief;
  if (!d) {
    const heading = screen("No call to review yet", h("p", { text: "Play a drill first. The debrief appears when the call ends." }), h("a", { href: "#/", class: "btn btn-primary" }, "Choose a drill"));
    return focusHeading(heading);
  }
  const safe = d.result === "safe";
  document.title = `Debrief · Scam Gym`;

  const actions = h(
    "div",
    { class: "actions" },
    study.isActive()
      ? h("button", { class: "btn btn-primary", type: "button", onclick: () => navigate("#/study") }, `Back to the study (${study.drillsDone()} of 2 drills done)`)
      : null,
    h("button", { class: `btn ${study.isActive() ? "" : "btn-primary"}`, type: "button", onclick: () => navigate(`#/drill/${d.scenarioId}`) }, "Try again"),
    h("button", { class: "btn", type: "button", onclick: () => navigate(study.isActive() ? "#/study" : "#/") }, "Try another drill"),
    d.offerFamilyCode ? h("button", { class: "btn", type: "button", onclick: () => navigate("#/family-code") }, "Set a family code word") : null
  );

  const heading = h("h1", { tabindex: "-1", class: "visually-hidden", text: `Debrief: ${d.title}` });
  main.replaceChildren(
    heading,
    h(
      "div",
      { class: `result result-${d.result}`, role: "status", "aria-live": "polite" },
      icon(safe ? "check" : "alert", "icon icon-lg"),
      h("div", {}, h("p", { class: "result-kind", text: safe ? "Safe outcome" : "Money lost (in the drill)" }), h("p", { class: "result-headline", text: d.headline }))
    ),
    h("div", { class: "habit" }, h("p", { class: "habit-label", text: "The habit" }), h("p", { class: "habit-text", text: d.habit })),
    h("h2", { text: "What the caller did" }),
    h(
      "ul",
      { class: "tactics", role: "list" },
      d.tactics.map((t) =>
        h(
          "li",
          { class: "tactic" },
          h("h3", { text: t.name }),
          h("p", { text: t.explanation }),
          h("p", { class: "safer" }, h("strong", { text: "Safer reply: " }), t.safer)
        )
      )
    ),
    h("h2", { text: "Your path" }),
    h(
      "ol",
      { class: "path" },
      d.path.map((p) => h("li", {}, typeTag(p.type), h("span", { text: p.label })))
    ),
    actions,
    realLifeHelp()
  );
  focusHeading(heading);
}

function realLifeHelp() {
  return h(
    "details",
    { class: "real" },
    h("summary", { text: "If this happened for real" }),
    h(
      "ul",
      {},
      h("li", { text: "Call your bank using the number on your card." }),
      h("li", { text: "Do not send more money." }),
      h("li", { text: "Keep screenshots of messages, numbers and account details." }),
      h(
        "li",
        {},
        "Report to the EFCC (",
        h("a", { href: "https://www.efcc.gov.ng", rel: "noreferrer noopener", target: "_blank" }, "efcc.gov.ng"),
        ") or the police."
      )
    )
  );
}

// ---------- Family code word ----------

function renderFamilyCode() {
  const input = h("input", { type: "text", id: "code-word", autocomplete: "off", spellcheck: "false", maxlength: "60" });
  const preview = h("p", { class: "message-preview", "aria-live": "off" });
  const feedback = h("p", { class: "status", role: "status" });
  const fallback = h("div");

  const message = () => {
    const word = input.value.trim();
    return `Our family code word is ${word || "[word]"}. If anyone calls asking for money, ask for it. If they cannot say it, hang up and call me on my normal number.`;
  };
  const update = () => {
    preview.textContent = message();
  };
  input.addEventListener("input", update);
  update();

  const copyBtn = h("button", {
    class: "btn btn-primary",
    type: "button",
    onclick: async () => {
      if (!input.value.trim()) {
        feedback.textContent = "Type a word or phrase first.";
        input.focus();
        return;
      }
      fallback.replaceChildren();
      try {
        await navigator.clipboard.writeText(message());
        feedback.textContent = "Copied. Paste it in a private message to each family member.";
      } catch {
        const area = h("textarea", { readonly: true, rows: "4", class: "copy-area", "aria-label": "Message to copy", text: message() });
        fallback.append(area);
        area.select();
        feedback.textContent = "Copy did not work in this browser. Select the text below and copy it.";
      }
    },
  });
  copyBtn.textContent = "Copy message for family";

  const heading = screen(
    "Set a family code word",
    h("p", { text: "A copied voice can sound exactly like someone you love. A code word is something a scammer cannot copy. Agree on it now, in person or on a normal call, before anyone needs it." }),
    h("div", { class: "field" }, h("label", { for: "code-word", text: "Your family code word or phrase" }), input, h("p", { class: "small", text: "Kept on this screen only. It is never stored or sent anywhere." })),
    h("h2", { text: "Message for your family" }),
    preview,
    copyBtn,
    feedback,
    fallback,
    h("p", { class: "notice", role: "note" }, icon("shield"), h("span", { text: "Do not share the word in public groups or on social media. Send it privately, or say it in person." })),
    h("a", { href: "#/", class: "btn" }, "Back to drills")
  );
  onCleanup(() => {
    input.value = "";
  });
  focusHeading(heading);
}

// ---------- About ----------

function renderAbout() {
  const chartSlot = h("div", {}, h("p", { class: "small", text: "Loading study results…" }));
  const heading = screen(
    "About Scam Gym",
    h("p", { class: "lead", text: "Scam Gym is a fire drill for scam calls. You take a fictional call, reply, and get a debrief that names each pressure trick and the safer reply." }),
    h("h2", { text: "How this works" }),
    h(
      "ol",
      {},
      h("li", { text: "Pick a drill and take the call. The caller's words are always shown on screen." }),
      h("li", { text: "Reply by tapping. If you turn voice on, you can also speak your reply." }),
      h("li", { text: "When the call ends, the debrief shows each trick the caller used and the habit to keep." })
    ),
    h("p", { text: "The one habit: stop, do not act on what the caller gave you, and verify through a channel you already trust. Call the number on your card, check your own banking app, or ask the family code word." }),
    h("h2", { text: "What it cannot do" }),
    h("p", { class: "limitation", text: "Scam Gym builds a habit through simulated practice. It cannot detect or stop real scams, and a real caller with a spoofed number or detailed personal information may be more convincing than any drill." }),
    h("h2", { text: "Privacy" }),
    h(
      "ul",
      {},
      h("li", { text: "No accounts, no cookies, no trackers." }),
      h("li", { text: "All people, banks and amounts in the drills are invented." }),
      h("li", { text: "Your replies stay on your device. The optional study saves only your answers and a random ID." }),
      h("li", { text: "Voice is off by default. Your browser's speech feature may send audio to its provider when voice is on." })
    ),
    h("h2", { text: "Before-and-after study" }),
    chartSlot,
    h("p", {}, h("a", { href: "#/study" }, "Take the before-and-after study")),
    h("h2", { text: "Credits" }),
    h(
      "ul",
      {},
      h("li", { text: "Browser Web Speech APIs (speech synthesis and speech recognition)" }),
      h("li", { text: "FastAPI, Uvicorn and Pydantic" }),
      h("li", { text: "LLM provider: none by default. Optional rephrasing can use a provider set by the host." })
    ),
    h("p", { text: "Built during Oct 17 to Nov 22, 2026 with AI coding assistance (Claude Code)." }),
    h("p", { text: "Pre-existing components: None." })
  );
  focusHeading(heading);
  study.renderSummary(chartSlot);
}

// ---------- Router ----------

function route() {
  runCleanups();
  const hash = location.hash || "#/";
  const [, path = "", param] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  try {
    switch (path) {
      case "":
        return renderHome();
      case "drill":
        return renderDrill(decodeURIComponent(param));
      case "debrief":
        return renderDebrief();
      case "family-code":
        return renderFamilyCode();
      case "study":
        return study.renderStudy(main, { screen, focusHeading, navigate, onCleanup, drillCards, safetyNotice, data: app.data });
      case "about":
        return renderAbout();
      default:
        return navigate("#/");
    }
  } catch (err) {
    console.warn(err);
    const heading = screen("Something went wrong", h("p", { text: "Please go back and try again." }), h("a", { href: "#/", class: "btn" }, "Back to drills"));
    focusHeading(heading);
  }
}

async function boot() {
  try {
    const res = await fetch("data/scenarios.json");
    app.data = await res.json();
  } catch {
    main.replaceChildren(h("h1", { text: "Scam Gym could not load" }), h("p", { text: "Check your connection and reload the page once. After that, it works offline." }));
    return;
  }
  window.addEventListener("hashchange", route);
  route();

  api.getHealth().then((health) => {
    app.llmEnabled = Boolean(health && health.llm_enabled);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
