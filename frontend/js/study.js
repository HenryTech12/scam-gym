// Optional before-and-after study. Everything lives in memory until the final, consented POST.

import { h, icon } from "./dom.js";
import * as api from "./api.js";

const DRILLS_NEEDED = 2;

let items = null;
let s = null; // study state, null when not started

function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadItems() {
  if (!items) {
    const res = await fetch("data/study_items.json");
    items = await res.json();
  }
  return items;
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
    preSet: preFirst ? "A" : "B",
    postSet: preFirst ? "B" : "A",
    pre: [],
    post: [],
    drills: new Set(),
    index: 0,
    saved: null,
  };
}

const setItems = (set) => items.items.filter((i) => i.set === set);
const verifyCount = (answers) => answers.filter((a) => a.answer === items.correct).length;

export async function renderStudy(main, ctx) {
  try {
    await loadItems();
  } catch {
    const heading = ctx.screen("Study unavailable", h("p", { text: "The study questions could not load. You can still play the drills." }), h("a", { href: "#/", class: "btn" }, "Back to drills"));
    return ctx.focusHeading(heading);
  }
  const rerender = () => renderStudy(main, ctx);

  if (!s || s.phase === "consent") return consent(ctx, rerender);
  if (s.phase === "pre" || s.phase === "post") return question(ctx, rerender);
  if (s.phase === "drills") return drills(ctx);
  if (s.phase === "done") return thanks(ctx);
}

function consent(ctx, rerender) {
  const box = h("input", { type: "checkbox", id: "consent" });
  const err = h("p", { class: "status", role: "status" });
  const heading = ctx.screen(
    "Before-and-after study",
    h("p", { text: "This is a short anonymous study for a hackathon project. We record only your answers and a random ID. No names or contact details. You can stop at any time." }),
    h("p", { text: "You answer 5 short questions, play any two drills, then answer 5 different questions. It takes about 5 minutes." }),
    h("div", { class: "toggle-row" }, box, h("label", { for: "consent", text: "I agree to take part" })),
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
              err.textContent = "Please tick the box to agree first, or go back to the drills.";
              box.focus();
              return;
            }
            start();
            rerender();
          },
        },
        "Start"
      ),
      h("a", { href: "#/", class: "btn" }, "Not now")
    )
  );
  ctx.focusHeading(heading);
}

function question(ctx, rerender) {
  const isPre = s.phase === "pre";
  const list = setItems(isPre ? s.preSet : s.postSet);
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
    isPre ? "Before the drills" : "After the drills",
    h("p", { class: "progress", text: `Question ${s.index + 1} of ${list.length}` }),
    h("div", { class: "item-card" }, h("p", { class: "item-text", text: item.text })),
    h("h2", { id: "q-prompt", text: "What would you do?" }),
    h(
      "div",
      { class: "replies", role: "group", "aria-labelledby": "q-prompt" },
      item.options.map((o) => h("button", { class: "btn btn-reply", type: "button", onclick: () => answer(o.id) }, o.label))
    ),
    h("button", { class: "btn btn-link", type: "button", onclick: () => stop(ctx) }, "Stop the study")
  );
  ctx.focusHeading(heading);
}

function stop(ctx) {
  s = null;
  ctx.navigate("#/");
}

function drills(ctx) {
  const done = s.drills.size;
  const heading = ctx.screen(
    "Now play two drills",
    h("p", { class: "progress", text: `${done} of ${DRILLS_NEEDED} drills done` }),
    h("p", { text: "Play any two different drills. After each call, come back here from the debrief." }),
    ctx.safetyNotice(),
    ctx.drillCards((id) => ctx.navigate(`#/drill/${id}`)),
    h("button", { class: "btn btn-link", type: "button", onclick: () => stop(ctx) }, "Stop the study")
  );
  ctx.focusHeading(heading);
}

async function submit() {
  const payload = {
    participant_id: s.pid,
    pre_set: s.preSet,
    post_set: s.postSet,
    pre: s.pre,
    post: s.post,
    drills_played: [...s.drills],
    consent: true,
  };
  const current = s;
  current.saved = "pending";
  current.saved = (await api.postStudySession(payload)) ? "yes" : "no";
  if (s === current && location.hash === "#/study") {
    const slot = document.getElementById("save-status");
    if (slot) slot.textContent = saveText(current.saved);
  }
}

function saveText(saved) {
  if (saved === "yes") return "Your answers were saved anonymously. Thank you.";
  if (saved === "no") return "Your results could not be saved, but you can still keep going.";
  return "Saving your answers…";
}

function thanks(ctx) {
  const pre = verifyCount(s.pre);
  const post = verifyCount(s.post);
  const chartSlot = h("div");
  const heading = ctx.screen(
    "Thank you",
    h("p", { id: "save-status", role: "status", text: saveText(s.saved) }),
    h(
      "dl",
      { class: "scores" },
      h("div", {}, h("dt", { text: "Before the drills" }), h("dd", { text: `${pre} of 5 safe answers` })),
      h("div", {}, h("dt", { text: "After the drills" }), h("dd", { text: `${post} of 5 safe answers` }))
    ),
    h("p", { class: "small", text: "A safe answer is one where you stop and verify through a channel you already trust." }),
    h("div", { class: "habit" }, h("p", { class: "habit-label", text: "The habit" }), h("p", { class: "habit-text", text: "Stop. Do not act on what the caller gave you. Verify through a channel you already trust." })),
    h("h2", { text: "Everyone's results so far" }),
    chartSlot,
    h(
      "div",
      { class: "actions" },
      h("a", { href: "#/", class: "btn btn-primary" }, "Back to drills"),
      h("a", { href: "#/family-code", class: "btn" }, "Set a family code word")
    )
  );
  ctx.focusHeading(heading);
  // Show the summary after the save has had a chance to land.
  setTimeout(() => renderSummary(chartSlot), s.saved === "pending" ? 1500 : 0);
  ctx.onCleanup(() => {
    if (s && s.phase === "done" && s.saved !== "pending") s = null;
  });
}

// Renders the aggregate study chart into `slot`. Used by the About page and the thank-you screen.
export async function renderSummary(slot) {
  const sum = await api.getStudySummary();
  if (!sum) {
    slot.replaceChildren(h("p", { class: "small", text: "Study results are not available right now (offline or no server)." }));
    return;
  }
  if (!sum.n) {
    slot.replaceChildren(h("p", { class: "small", text: "No study results yet." }));
    return;
  }
  const pct = (r) => Math.round(r * 100);
  const bar = (label, rate, cls) => {
    const fill = h("span", { class: `bar-fill ${cls}` });
    fill.style.width = `${pct(rate)}%`; // CSSOM, allowed by the CSP
    return h("div", { class: "bar-row" }, h("span", { class: "bar-label", text: label }), h("span", { class: "bar", "aria-hidden": "true" }, fill), h("span", { class: "bar-value", text: `${pct(rate)}%` }));
  };
  const change = sum.change_points;
  slot.replaceChildren(
    h(
      "figure",
      { class: "chart" },
      h("figcaption", {}, `Share of answers that chose to verify. n = ${sum.n} ${sum.n === 1 ? "participant" : "participants"}. `, h("em", { text: sum.label || "Small sample, self-reported" })),
      bar("Before", sum.pre_verify_rate, "bar-pre"),
      bar("After", sum.post_verify_rate, "bar-post"),
      h("p", { class: "small", text: `Change: ${change >= 0 ? "+" : ""}${change} percentage points.` })
    ),
    h("p", { class: "small" }, icon("alert", "icon icon-sm"), " This is a small, self-reported practice study, not proof that anyone is protected from real scams.")
  );
}
