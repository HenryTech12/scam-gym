// Optional before-and-after study. Everything lives in memory until the final, consented POST.

import { h, icon } from "./dom.js";
import { t, getLang } from "./i18n.js";
import * as api from "./api.js";

const DRILLS_NEEDED = 2;

const itemCache = new Map();
let s = null; // study state, null when not started

function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Items keep the same ids (A1-A5, B1-B5) in every language, so results stay comparable.
async function loadItems(lang) {
  if (!itemCache.has(lang)) {
    const res = await fetch(`data/study_items.${lang}.json`);
    if (!res.ok) throw new Error(`study items ${lang}: ${res.status}`);
    itemCache.set(lang, await res.json());
  }
  return itemCache.get(lang);
}

// True while the participant is between the pre-test and the post-test.
export function isActive() {
  return Boolean(s && (s.phase === "drills" || (s.phase === "post" && s.post.length === 0)));
}

export function drillsDone() {
  return s ? s.drills.size : 0;
}

export function recordDrill(id) {
  if (!s || s.phase !== "drills") return;
  s.drills.add(id);
  if (s.drills.size >= DRILLS_NEEDED) {
    s.phase = "post";
    s.index = 0;
  }
}

function start() {
  const preFirst = crypto.getRandomValues(new Uint8Array(1))[0] < 128;
  s = {
    phase: "pre",
    pid: uuid4(),
    lang: getLang(),
    preSet: preFirst ? "A" : "B",
    postSet: preFirst ? "B" : "A",
    pre: [],
    post: [],
    drills: new Set(),
    index: 0,
    saved: null,
  };
}

export async function renderStudy(main, ctx) {
  let items;
  try {
    items = await loadItems(getLang());
  } catch {
    const heading = ctx.screen(t("study.unavailableTitle"), h("p", { text: t("study.unavailableBody") }), h("a", { href: "#/", class: "btn" }, t("common.backToDrills")));
    return ctx.focusHeading(heading);
  }
  const rerender = () => renderStudy(main, ctx);

  if (!s) return consent(ctx, rerender);
  if (s.phase === "pre" || s.phase === "post") return question(ctx, items, rerender);
  if (s.phase === "drills") return drills(ctx);
  if (s.phase === "done") return thanks(ctx, items);
}

function consent(ctx, rerender) {
  const box = h("input", { type: "checkbox", id: "consent" });
  const err = h("p", { class: "status", role: "status" });
  const heading = ctx.screen(
    t("study.title"),
    h("p", { text: t("study.consent") }),
    h("p", { text: t("study.about") }),
    h("div", { class: "toggle-row" }, box, h("label", { for: "consent", text: t("study.agree") })),
    err,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          onclick: () => {
            if (!box.checked) {
              err.textContent = t("study.agreeFirst");
              box.focus();
              return;
            }
            start();
            rerender();
          },
        },
        t("study.start")
      ),
      h("a", { href: "#/", class: "btn" }, t("study.notNow"))
    )
  );
  ctx.focusHeading(heading);
}

function question(ctx, items, rerender) {
  const isPre = s.phase === "pre";
  const list = items.items.filter((i) => i.set === (isPre ? s.preSet : s.postSet));
  const answers = isPre ? s.pre : s.post;
  const item = list[s.index];

  const answer = (optionId) => {
    answers.push({ item_id: item.id, answer: optionId });
    s.index += 1;
    if (s.index >= list.length) {
      if (isPre) s.phase = "drills";
      else {
        s.phase = "done";
        submit();
      }
    }
    rerender();
  };

  const heading = ctx.screen(
    isPre ? t("study.beforeTitle") : t("study.afterTitle"),
    h("p", { class: "progress", text: t("study.questionOf", { n: s.index + 1, total: list.length }) }),
    h("div", { class: "item-card" }, h("p", { class: "item-text", text: item.text })),
    h("h2", { id: "q-prompt", text: t("study.whatWouldYouDo") }),
    h(
      "div",
      { class: "replies", role: "group", "aria-labelledby": "q-prompt" },
      item.options.map((o) => h("button", { class: "btn btn-reply", type: "button", onclick: () => answer(o.id) }, o.label))
    ),
    h("button", { class: "btn btn-link", type: "button", onclick: () => stop(ctx) }, t("study.stop"))
  );
  ctx.focusHeading(heading);
}

function stop(ctx) {
  s = null;
  ctx.navigate("#/");
}

function drills(ctx) {
  const heading = ctx.screen(
    t("study.drillsTitle"),
    h("p", { class: "progress", text: t("study.drillsDone", { n: s.drills.size, total: DRILLS_NEEDED }) }),
    h("p", { text: t("study.drillsBody") }),
    ctx.safetyNotice(),
    ctx.drillCards((id) => ctx.navigate(`#/drill/${id}`)),
    h("button", { class: "btn btn-link", type: "button", onclick: () => stop(ctx) }, t("study.stop"))
  );
  ctx.focusHeading(heading);
}

async function submit() {
  const current = s;
  const payload = {
    participant_id: current.pid,
    lang: current.lang,
    pre_set: current.preSet,
    post_set: current.postSet,
    pre: current.pre,
    post: current.post,
    drills_played: [...current.drills],
    consent: true,
  };
  current.saved = "pending";
  current.saved = (await api.postStudySession(payload)) ? "yes" : "no";
  if (s === current) {
    const slot = document.getElementById("save-status");
    if (slot) slot.textContent = saveText(current.saved);
  }
}

function saveText(saved) {
  if (saved === "yes") return t("study.saved");
  if (saved === "no") return t("study.notSaved");
  return t("study.saving");
}

function thanks(ctx, items) {
  const verify = (answers) => answers.filter((a) => a.answer === items.correct).length;
  const chartSlot = h("div");
  const heading = ctx.screen(
    t("study.thanksTitle"),
    h("p", { id: "save-status", role: "status", text: saveText(s.saved) }),
    h(
      "dl",
      { class: "scores" },
      h("div", {}, h("dt", { text: t("study.beforeScore") }), h("dd", { text: t("study.scoreValue", { n: verify(s.pre) }) })),
      h("div", {}, h("dt", { text: t("study.afterScore") }), h("dd", { text: t("study.scoreValue", { n: verify(s.post) }) }))
    ),
    h("p", { class: "small", text: t("study.safeAnswerNote") }),
    h("div", { class: "habit" }, h("p", { class: "habit-label", text: t("debrief.habit") }), h("p", { class: "habit-text", text: t("study.habit") })),
    h("h2", { text: t("study.everyone") }),
    chartSlot,
    h(
      "div",
      { class: "actions" },
      h("a", { href: "#/", class: "btn btn-primary" }, t("common.backToDrills")),
      h("a", { href: "#/family-code", class: "btn" }, t("debrief.setCode"))
    )
  );
  ctx.focusHeading(heading);
  // Show the summary after the save has had a chance to land.
  setTimeout(() => renderSummary(chartSlot), s.saved === "pending" ? 1500 : 0);
  ctx.onCleanup(() => {
    if (s && s.phase === "done" && s.saved !== "pending" && !location.hash.startsWith("#/study")) s = null;
  });
}

// Renders the aggregate study chart (all languages combined) into `slot`.
// Used by the About page and the thank-you screen.
export async function renderSummary(slot) {
  const sum = await api.getStudySummary();
  if (!sum) {
    slot.replaceChildren(h("p", { class: "small", text: t("chart.unavailable") }));
    return;
  }
  if (!sum.n) {
    slot.replaceChildren(h("p", { class: "small", text: t("chart.empty") }));
    return;
  }
  const pct = (r) => Math.round(r * 100);
  const bar = (label, rate, cls) => {
    const fill = h("span", { class: `bar-fill ${cls}` });
    fill.style.width = `${pct(rate)}%`; // CSSOM, allowed by the CSP
    return h("div", { class: "bar-row" }, h("span", { class: "bar-label", text: label }), h("span", { class: "bar", "aria-hidden": "true" }, fill), h("span", { class: "bar-value", text: `${pct(rate)}%` }));
  };
  const change = `${sum.change_points >= 0 ? "+" : ""}${sum.change_points}`;
  slot.replaceChildren(
    h(
      "figure",
      { class: "chart" },
      h(
        "figcaption",
        {},
        `${t("chart.caption", { n: sum.n, participants: sum.n === 1 ? t("chart.participantOne") : t("chart.participantMany") })} `,
        h("em", { text: t("chart.label") })
      ),
      bar(t("chart.before"), sum.pre_verify_rate, "bar-pre"),
      bar(t("chart.after"), sum.post_verify_rate, "bar-post"),
      h("p", { class: "small", text: t("chart.change", { change }) })
    ),
    h("p", { class: "small" }, icon("alert", "icon icon-sm"), ` ${t("chart.disclaimer")}`)
  );
}
