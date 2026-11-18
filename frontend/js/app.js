// Router and screen rendering. The whole drill runs locally from the bundled
// data/scenarios.<lang>.json; the backend is optional.

import { h, icon, typeTag } from "./dom.js";
import { createRun, getNode, choose, endCall, isEnd, pressure, DrillError } from "./engine.js";
import { match } from "./matcher.js";
import { buildDebrief } from "./debrief.js";
import { t, setLang, getLang, detectLang, LANGS, LANG_NAMES } from "./i18n.js";
import * as voice from "./voice.js";
import * as api from "./api.js";
import * as study from "./study.js";

const app = {
  data: null,
  voiceOn: false, // kept in memory only
  llmEnabled: false,
  lastRun: null, // { scenarioId, history, endId, tacticsSeen } so the debrief can re-render in any language
  inCall: false,
  cleanups: [],
};

const main = document.getElementById("app");
const dataCache = new Map();

// ---------- data ----------

async function loadScenarios(lang) {
  if (!dataCache.has(lang)) {
    dataCache.set(
      lang,
      fetch(`data/scenarios.${lang}.json`).then((r) => {
        if (!r.ok) throw new Error(`scenarios ${lang}: ${r.status}`);
        return r.json();
      })
    );
  }
  try {
    return await dataCache.get(lang);
  } catch (err) {
    dataCache.delete(lang);
    throw err;
  }
}

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
  return h("p", { class: "notice", role: "note" }, icon("shield"), h("span", { text: t("safety.notice") }));
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
        h("button", { class: "btn btn-primary", type: "button", onclick: () => onStart(s.id), "aria-label": t("home.startAria", { title: s.title }) }, t("home.start"))
      )
    )
  );
}

// ---------- language ----------

function langSelector(variant) {
  const current = getLang();
  return h(
    "div",
    { class: `lang-select lang-${variant}`, role: "group", "aria-label": t("lang.label") },
    LANGS.map((code) =>
      h(
        "button",
        {
          type: "button",
          class: "lang-btn",
          lang: code,
          "data-lang": code,
          "data-variant": variant,
          "aria-pressed": String(code === current),
          onclick: () => changeLang(code, variant),
        },
        // The header shows short codes to save space; screen readers also hear the full name.
        variant === "header" ? [code.toUpperCase(), h("span", { class: "visually-hidden", text: ` ${LANG_NAMES[code]}` })] : LANG_NAMES[code]
      )
    )
  );
}

function announce(text) {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => {
    el.textContent = text;
  }, 50);
}

function cacheLangOffline(lang) {
  navigator.serviceWorker?.ready
    .then((reg) => reg.active?.postMessage({ type: "cache-lang", lang }))
    .catch(() => {});
}

async function changeLang(code, variant) {
  if (app.inCall || code === getLang()) return;
  let data;
  try {
    data = await loadScenarios(code);
  } catch {
    return; // stay in the current language if the pack cannot load (offline and never opened)
  }
  await setLang(code);
  app.data = data;
  try {
    const url = new URL(location.href);
    url.searchParams.set("lang", code);
    history.replaceState(null, "", url);
  } catch {
    /* ignore */
  }
  cacheLangOffline(code);
  route();
  announce(t("lang.changed"));
  requestAnimationFrame(() => document.querySelector(`.lang-btn[data-variant="${variant}"][data-lang="${code}"]`)?.focus());
}

function renderChrome() {
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  const set = (sel, key) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  };
  set(".skip-link", "skip");
  set('[data-i18n="nav.drills"]', "nav.drills");
  set('[data-i18n="nav.code"]', "nav.code");
  set('[data-i18n="nav.about"]', "nav.about");
  set(".site-footer p", "footer");
  document.querySelector(".site-header nav")?.setAttribute("aria-label", t("nav.label"));
  const slot = document.getElementById("lang-header");
  // Language switching is hidden during a call to avoid a state mismatch.
  if (slot) slot.replaceChildren(app.inCall ? "" : langSelector("header"));
}

// ---------- Home ----------

function renderHome() {
  const heading = screen(
    t("home.title"),
    h("p", { class: "lead", text: t("home.lead") }),
    langSelector("home"),
    safetyNotice(),
    voiceToggle(),
    h("h2", { text: t("home.chooseDrill") }),
    drillCards((id) => navigate(`#/drill/${id}`)),
    h(
      "ul",
      { class: "links", role: "list" },
      h("li", {}, h("a", { href: "#/about" }, t("home.how"))),
      h("li", {}, h("a", { href: "#/study" }, t("home.study"))),
      h("li", {}, h("a", { href: "#/family-code" }, t("home.familyCode")))
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
    h("div", { class: "toggle-row" }, input, h("label", { for: id, text: t("voice.toggle") })),
    h("p", { id: "voice-note", class: "small", text: t("voice.note") })
  );
}

// ---------- Call screen ----------

function renderDrill(id) {
  const scenario = scenarioById(id);
  if (!scenario) {
    const heading = screen(t("drill.notFound"), h("p", { text: t("drill.notFoundBody") }), h("a", { href: "#/", class: "btn" }, t("common.backToDrills")));
    return focusHeading(heading);
  }

  const lang = getLang();
  let state = createRun(app.data, id);
  let token = 0; // guards async work from a previous line
  const started = Date.now();
  app.inCall = true;
  onCleanup(() => {
    app.inCall = false;
  });
  renderChrome();

  const timer = h("span", { class: "timer", role: "timer", "aria-label": t("call.time"), text: "00:00" });
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  onCleanup(() => clearInterval(tick));

  const meterSegs = [0, 1, 2, 3].map(() => h("span", { class: "seg" }));
  const meterText = h("span", { class: "meter-text" });
  const meter = h(
    "div",
    { class: "pressure" },
    h("span", { class: "meter-label", text: t("call.pressure") }),
    h("span", { class: "segs", "aria-hidden": "true" }, meterSegs),
    meterText
  );

  const caption = h("p", { class: "caption-text", id: "caption", "aria-live": "polite" });
  const visualSlot = h("div");
  const replyHeading = h("h2", { class: "reply-heading", tabindex: "-1", id: "reply-heading", text: t("call.yourReply") });
  const replies = h("div", { class: "replies", role: "group", "aria-labelledby": "reply-heading" });
  const status = h("p", { class: "status", role: "status" });
  const voiceNote = h("p", { class: "small voice-note" });
  const micSlot = h("div");

  const endBtn = h("button", { class: "btn btn-end", type: "button", onclick: () => finish(endCall(state)) }, icon("phoneOff"), t("call.endCall"));

  const avatarText = scenario.caller.name
    .replace(/[^\p{L} ]/gu, "")
    .split(" ")
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  document.title = `${scenario.title} · Scam Gym`;
  main.replaceChildren(
    h(
      "section",
      { class: "call", "aria-label": t("call.aria") },
      h("h1", { class: "visually-hidden", tabindex: "-1", id: "call-title", text: t("call.heading", { title: scenario.title }) }),
      h(
        "div",
        { class: "call-head" },
        h("div", { class: "avatar", "aria-hidden": "true", text: avatarText || "?" }),
        h("div", { class: "who" }, h("p", { class: "caller-name", text: scenario.caller.name }), h("p", { class: "caller-role", text: scenario.caller.role })),
        h("div", { class: "call-meta" }, h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "visually-hidden", text: t("call.inProgress") }), timer)
      ),
      scenario.notice ? h("p", { class: "sim-label", text: scenario.notice }) : null,
      meter,
      h("div", { class: "caption" }, h("p", { class: "caption-label", text: t("call.callerSays") }), caption),
      voiceNote,
      visualSlot,
      replyHeading,
      replies,
      micSlot,
      status,
      h("div", { class: "end-wrap" }, endBtn, h("p", { class: "small", text: t("call.endNote") }))
    )
  );
  focusHeading(document.getElementById("call-title"));

  function finish(endState) {
    runCleanups();
    app.lastRun = {
      scenarioId: endState.scenarioId,
      history: endState.history,
      endId: endState.endId,
      tacticsSeen: [...endState.tacticsSeen],
    };
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
      status.textContent = err instanceof DrillError ? t("call.notCaught") : t("call.error");
    }
  }

  async function showNode(moveFocus) {
    const my = ++token;
    const node = getNode(state);
    const level = pressure(state);
    meterSegs.forEach((s, i) => s.classList.toggle("on", i < level));
    meterText.textContent = t("call.pressureOf", { n: level });
    status.textContent = "";

    let line = node.say;
    if (app.llmEnabled) {
      caption.classList.add("waiting");
      const res = await api.rephrase(state.scenarioId, state.nodeId, lang);
      if (my !== token) return;
      caption.classList.remove("waiting");
      if (res?.say) line = res.say;
    }
    caption.textContent = line;

    visualSlot.replaceChildren(node.visual ? smsCard(node.visual) : "");
    replies.replaceChildren(...node.choices.map((c) => h("button", { class: "btn btn-reply", type: "button", onclick: () => pick(c.id) }, c.label)));

    micSlot.replaceChildren();
    if (app.voiceOn && voice.isSupported()) {
      const mic = h("button", { class: "btn btn-mic", type: "button" }, icon("mic"), t("call.sayReply"));
      mic.addEventListener("click", async () => {
        mic.disabled = true;
        status.textContent = t("call.listening");
        const { transcript } = await voice.listen(lang);
        if (my !== token) return;
        mic.disabled = false;
        if (!transcript) {
          status.textContent = t("call.notCaught");
          return;
        }
        const result = match(transcript, node.choices, lang);
        if (!result) {
          status.textContent = `${t("call.youSaid", { text: transcript })} ${t("call.notCaught")}`;
          return;
        }
        pick(result.choiceId);
      });
      micSlot.append(mic);
      voice.speak(line, scenario.caller.voice, lang).then((spoken) => {
        if (my === token && spoken === "no-voice") voiceNote.textContent = t("call.noVoice");
      });
    }

    if (moveFocus) replyHeading.focus();
  }

  showNode(false);
}

function smsCard(visual) {
  return h(
    "figure",
    { class: "sms" },
    h("p", { class: "sms-from" }, icon("message", "icon icon-sm"), h("span", { text: t("call.smsFrom", { sender: visual.sender }) })),
    h("blockquote", { class: "sms-body", text: visual.text }),
    h("figcaption", { class: "small", text: visual.note })
  );
}

// ---------- Debrief ----------

function renderDebrief() {
  const run = app.lastRun;
  const scenario = run && scenarioById(run.scenarioId);
  if (!scenario) {
    const heading = screen(t("debrief.noneTitle"), h("p", { text: t("debrief.noneBody") }), h("a", { href: "#/", class: "btn btn-primary" }, t("common.chooseDrill")));
    return focusHeading(heading);
  }
  // Rebuilt from ids, so switching language on this screen shows the same debrief translated.
  const d = buildDebrief({ ...run, scenario, tacticsSeen: new Set(run.tacticsSeen) }, app.data.tactics_glossary, t("debrief.endedCall"));
  const safe = d.result === "safe";
  const inStudy = study.isActive();
  document.title = `${t("debrief.title", { title: d.title })} · Scam Gym`;

  const actions = h(
    "div",
    { class: "actions" },
    inStudy ? h("button", { class: "btn btn-primary", type: "button", onclick: () => navigate("#/study") }, t("debrief.backToStudy", { n: study.drillsDone() })) : null,
    h("button", { class: `btn ${inStudy ? "" : "btn-primary"}`, type: "button", onclick: () => navigate(`#/drill/${d.scenarioId}`) }, t("debrief.tryAgain")),
    h("button", { class: "btn", type: "button", onclick: () => navigate(inStudy ? "#/study" : "#/") }, t("debrief.tryAnother")),
    d.offerFamilyCode ? h("button", { class: "btn", type: "button", onclick: () => navigate("#/family-code") }, t("debrief.setCode")) : null
  );

  const heading = h("h1", { tabindex: "-1", class: "visually-hidden", text: t("debrief.title", { title: d.title }) });
  main.replaceChildren(
    heading,
    h(
      "div",
      { class: `result result-${d.result}`, role: "status", "aria-live": "polite" },
      icon(safe ? "check" : "alert", "icon icon-lg"),
      h("div", {}, h("p", { class: "result-kind", text: safe ? t("debrief.safeKind") : t("debrief.lostKind") }), h("p", { class: "result-headline", text: d.headline }))
    ),
    h("div", { class: "habit" }, h("p", { class: "habit-label", text: t("debrief.habit") }), h("p", { class: "habit-text", text: d.habit })),
    h("h2", { text: t("debrief.tacticsTitle") }),
    h(
      "ul",
      { class: "tactics", role: "list" },
      d.tactics.map((tc) =>
        h("li", { class: "tactic" }, h("h3", { text: tc.name }), h("p", { text: tc.explanation }), h("p", { class: "safer" }, h("strong", { text: `${t("debrief.saferReply")} ` }), tc.safer))
      )
    ),
    h("h2", { text: t("debrief.pathTitle") }),
    h("ol", { class: "path" }, d.path.map((p) => h("li", {}, typeTag(p.type), h("span", { text: p.label })))),
    actions,
    h(
      "details",
      { class: "real" },
      h("summary", { text: t("real.title") }),
      h("ul", {}, ["real.1", "real.2", "real.3", "real.4"].map((k) => h("li", { text: t(k) })))
    )
  );
  focusHeading(heading);
}

// ---------- Family code word ----------

function renderFamilyCode() {
  const input = h("input", { type: "text", id: "code-word", autocomplete: "off", spellcheck: "false", maxlength: "60" });
  const preview = h("p", { class: "message-preview" });
  const feedback = h("p", { class: "status", role: "status" });
  const fallback = h("div");

  const message = () => t("family.message", { word: input.value.trim() || t("family.placeholder") });
  const update = () => {
    preview.textContent = message();
  };
  input.addEventListener("input", update);
  update();

  const copyBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        if (!input.value.trim()) {
          feedback.textContent = t("family.typeFirst");
          input.focus();
          return;
        }
        fallback.replaceChildren();
        try {
          await navigator.clipboard.writeText(message());
          feedback.textContent = t("family.copied");
        } catch {
          const area = h("textarea", { readonly: true, rows: "4", class: "copy-area", "aria-label": t("family.copyArea"), text: message() });
          fallback.append(area);
          area.select();
          feedback.textContent = t("family.copyFailed");
        }
      },
    },
    t("family.copy")
  );

  const heading = screen(
    t("family.title"),
    h("p", { text: t("family.intro") }),
    h("div", { class: "field" }, h("label", { for: "code-word", text: t("family.label") }), input, h("p", { class: "small", text: t("family.inputNote") })),
    h("h2", { text: t("family.messageTitle") }),
    preview,
    copyBtn,
    feedback,
    fallback,
    h("p", { class: "notice", role: "note" }, icon("shield"), h("span", { text: t("family.warning") })),
    h("a", { href: "#/", class: "btn" }, t("common.backToDrills"))
  );
  onCleanup(() => {
    input.value = "";
  });
  focusHeading(heading);
}

// ---------- About ----------

function renderAbout() {
  const chartSlot = h("div", {}, h("p", { class: "small", text: t("about.loadingResults") }));
  const heading = screen(
    t("about.title"),
    h("p", { class: "lead", text: t("about.lead") }),
    h("h2", { text: t("about.howTitle") }),
    h("ol", {}, ["about.how1", "about.how2", "about.how3"].map((k) => h("li", { text: t(k) }))),
    h("p", { text: t("about.habit") }),
    h("h2", { text: t("about.cannotTitle") }),
    h("p", { class: "limitation", text: t("about.limitation") }),
    h("p", { text: t("about.voiceLimitation") }),
    h("h2", { text: t("about.privacyTitle") }),
    h("ul", {}, ["about.privacy1", "about.privacy2", "about.privacy3", "about.privacy4"].map((k) => h("li", { text: t(k) }))),
    h("h2", { text: t("about.studyTitle") }),
    chartSlot,
    h("p", {}, h("a", { href: "#/study" }, t("about.studyLink"))),
    h("h2", { text: t("about.languagesTitle") }),
    h("p", { text: t("about.translationNote") }),
    h("h2", { text: t("about.creditsTitle") }),
    h("ul", {}, ["about.credit1", "about.credit2", "about.credit3"].map((k) => h("li", { text: t(k) }))),
    h("p", { text: t("about.built") }),
    h("p", { text: t("about.preexisting") })
  );
  focusHeading(heading);
  study.renderSummary(chartSlot);
}

// ---------- Router ----------

function route() {
  runCleanups();
  renderChrome();
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
        return study.renderStudy(main, { screen, focusHeading, navigate, onCleanup, drillCards, safetyNotice });
      case "about":
        return renderAbout();
      default:
        return navigate("#/");
    }
  } catch (err) {
    console.warn(err);
    const heading = screen(t("error.title"), h("p", { text: t("error.body") }), h("a", { href: "#/", class: "btn" }, t("common.backToDrills")));
    focusHeading(heading);
  }
}

async function boot() {
  const lang = await setLang(detectLang());
  try {
    app.data = await loadScenarios(lang);
  } catch {
    main.replaceChildren(h("h1", { text: t("load.failTitle") }), h("p", { text: t("load.failBody") }));
    return;
  }
  window.addEventListener("hashchange", () => route());
  route();

  api.getHealth().then((health) => {
    app.llmEnabled = Boolean(health && health.llm_enabled);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => cacheLangOffline(lang))
      .catch(() => {});
  }
}

boot();
