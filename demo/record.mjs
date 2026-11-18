// Records each demo scene as its own clip from the real app (tap mode, voice off).
//
// Sharpness: Playwright's video recorder and Chrome's screencast both capture at 1x, which is
// blurry at 980 px tall. So this script grabs frames itself with Page.captureScreenshot at
// scale 2 (about 19 fps, 824x1830) and turns them into a 30 fps clip with ffmpeg.
//
// Actions are scheduled against the narration timings in narration/durations.json, so taps
// land on the words that describe them. Tap circles and tactic highlights are injected only
// into the recording; the app code is untouched.
//
// Usage: node demo/record.mjs [--base http://localhost:8000] [--scenes S2,S3] [--screens-only]

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DEMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEMO, '..');
const OUT = path.join(DEMO, 'out');
const CLIPS = path.join(OUT, 'clips');
const TMP = path.join(OUT, 'tmp');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('--base', 'http://localhost:8000').replace(/\/$/, '') + '/';

const cfg = JSON.parse(fs.readFileSync(path.join(DEMO, 'scenes.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(DEMO, 'narration', 'durations.json'), 'utf8'));
const studyPath = path.join(DEMO, 'narration', 'study.json');
const STUDY = D.with_study && fs.existsSync(studyPath) ? JSON.parse(fs.readFileSync(studyPath, 'utf8')) : null;
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const I18N = { en: readJson('frontend/i18n/en.json'), es: readJson('frontend/i18n/es.json'), fr: readJson('frontend/i18n/fr.json') };
const SC = { en: readJson('frontend/data/scenarios.en.json'), es: readJson('frontend/data/scenarios.es.json') };
const t = (lang, key, vars = {}) => I18N[lang][key].replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const scenario = (lang, id) => SC[lang].scenarios.find((s) => s.id === id);
const choiceLabel = (lang, sid, nid, cid) => scenario(lang, sid).nodes[nid].choices.find((c) => c.id === cid).label;
const startName = (lang, sid) => t(lang, 'home.startAria', { title: scenario(lang, sid).title });

const APP = { width: 412, height: 915, scale: 2 };
const CARD = { width: 1920, height: 1080, scale: 1 };

fs.mkdirSync(CLIPS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ proxy });

async function newPage(size, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    isMobile: size === APP,
    hasTouch: size === APP,
    colorScheme: 'light',
    locale: 'en-GB',
    ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  return { ctx, page };
}

// ---------- in-recording helpers ----------
async function smoothScrollTo(page, target, ms = 700) {
  // target: a selector (scrolled to block start minus 16 px) or a number (absolute y).
  await page.evaluate(async ({ target, ms }) => {
    const y0 = scrollY;
    let y1 = typeof target === 'number' ? target : (document.querySelector(target)?.getBoundingClientRect().top ?? 0) + scrollY - 16;
    y1 = Math.max(0, Math.min(y1, document.documentElement.scrollHeight - innerHeight));
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        scrollTo(0, y0 + (y1 - y0) * e);
        p < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }, { target, ms });
}

async function centerOn(page, locator, ms = 600) {
  const box = await locator.boundingBox();
  if (!box) return;
  const y = await page.evaluate(() => scrollY);
  const vh = page.viewportSize().height;
  if (box.y > 60 && box.y + box.height < vh - 60) return; // already comfortably visible
  await smoothScrollTo(page, y + box.y - vh / 2 + box.height / 2, ms);
}

// A 40 px translucent circle that fades in over 300 ms where the tap lands.
async function tap(page, locator) {
  await centerOn(page, locator, 450);
  const box = await locator.boundingBox();
  await page.evaluate(({ x, y }) => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', left: `${x - 20}px`, top: `${y - 20}px`, width: '40px', height: '40px', borderRadius: '50%',
      background: 'rgba(232, 110, 60, 0.45)', border: '2px solid rgba(232, 110, 60, 0.95)', pointerEvents: 'none', zIndex: 99999,
    });
    d.setAttribute('data-demo-tap', '');
    document.body.appendChild(d);
    d.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, fill: 'forwards' });
    setTimeout(() => d.remove(), 2000); // safety net
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(380);
  await locator.tap();
  // Fade out right away, so the circle never sits on top of the next screen.
  await page.evaluate(() => document.querySelectorAll('[data-demo-tap]').forEach((d) => {
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    setTimeout(() => d.remove(), 180);
  }));
}

async function highlight(page, selector, index) {
  await page.evaluate(({ selector, index }) => {
    document.querySelectorAll('[data-demo-hl]').forEach((el) => { el.style.outline = ''; el.removeAttribute('data-demo-hl'); });
    if (index < 0) return;
    const el = document.querySelectorAll(selector)[index];
    if (!el) return;
    el.setAttribute('data-demo-hl', '');
    el.style.outline = '4px solid rgba(232, 110, 60, 0.9)';
    el.style.outlineOffset = '3px';
  }, { selector, index });
}

const reply = (page, label) => page.locator('.btn-reply', { hasText: label }).first();
const button = (page, name) => page.getByRole('button', { name, exact: true }).first();

// ---------- frame capture ----------
async function record(page, id, size, length, script) {
  const cdp = await page.context().newCDPSession(page);
  const dir = path.join(TMP, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let running = true;
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const loop = (async () => {
    while (running) {
      const at = clock();
      let y = 0;
      try { y = (await cdp.send('Runtime.evaluate', { expression: 'scrollY', returnByValue: true })).result.value || 0; } catch { /* navigating */ }
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 93, optimizeForSpeed: true,
        clip: { x: 0, y, width: size.width, height: size.height, scale: size.scale },
      }).catch(() => null);
      if (!shot) continue;
      const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
      frames.push({ f, t: at });
    }
  })();
  const at = async (s) => { const wait = s - clock(); if (wait > 0) await page.waitForTimeout(wait * 1000); };
  await script(at);
  await at(length);
  running = false;
  await loop;
  // Variable-rate frames -> constant 30 fps clip of exactly `length` seconds.
  const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? length) - fr.t).toFixed(4)}`);
  list.push(`file '${frames.at(-1).f}'`);
  const listPath = path.join(dir, 'list.txt');
  fs.writeFileSync(listPath, list.join('\n'));
  const out = path.join(CLIPS, `${id}.mp4`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', 'fps=30,format=yuv420p', '-t', length.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  const fps = frames.length / length;
  console.log(`  ${id}: ${length.toFixed(2)}s, ${frames.length} frames (${fps.toFixed(1)} captured fps) -> ${path.relative(ROOT, out)}`);
  if (page.errors.length) throw new Error(`${id}: console errors while recording: ${page.errors.join(' | ')}`);
}

// ---------- scenes ----------
const seg = (id) => D.scenes[id].segments;
const lengthOf = (id) => D.scenes[id].duration + cfg.tail + (cfg.scenes.find((s) => s.id === id).hold || 0);
const S = (id, i) => seg(id)[i].start;
const E = (id, i) => seg(id)[i].end;

async function goHome(page, lang = 'en') {
  await page.goto(`${BASE}?lang=${lang}#/`);
  await page.waitForSelector('.cards');
  await page.evaluate(() => scrollTo(0, 0));
}

async function playToLostDebrief(page) {
  await goHome(page);
  await page.getByRole('button', { name: startName('en', 'bank-call') }).tap();
  await reply(page, choiceLabel('en', 'bank-call', 'n1', 'c1')).tap();
  await reply(page, choiceLabel('en', 'bank-call', 'n2', 'c1')).tap();
  await page.waitForSelector('.result');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
}

const SCENES = {
  async S1() {
    const total = lengthOf('S1');
    const cardLen = total - 3.0; // last 3 s cut to the Scam Gym Home screen
    const { ctx, page } = await newPage(CARD);
    const q = new URLSearchParams({ note: cfg.lower_third, noteAt: String(Math.min(12, cardLen - 3.5)) });
    await page.goto(`file://${path.join(DEMO, 'cards', 'incoming.html')}?${q}`);
    await record(page, 'S1a', CARD, cardLen, async () => {});
    await ctx.close();
    const app = await newPage(APP);
    await goHome(app.page);
    await record(app.page, 'S1b', APP, 3.0, async () => {});
    await app.ctx.close();
  },

  async S2() {
    const id = 'S2';
    const { ctx, page } = await newPage(APP);
    await goHome(page);
    await record(page, id, APP, lengthOf(id), async (at) => {
      const start = page.getByRole('button', { name: startName('en', 'bank-call') });
      await at(0.35);
      await centerOn(page, start, 800);
      await at(S(id, 0) + 0.9);
      await tap(page, start);
      await at(E(id, 2) - 0.35); // "...so I give my date of birth."
      await tap(page, reply(page, choiceLabel('en', 'bank-call', 'n1', 'c1')));
      await at(E(id, 3) - 0.35); // "...and I read it out."
      await tap(page, reply(page, choiceLabel('en', 'bank-call', 'n2', 'c1')));
      await page.waitForSelector('.result');
    });
    await ctx.close();
  },

  async S3() {
    const id = 'S3';
    const { ctx, page } = await newPage(APP);
    await playToLostDebrief(page);
    const sentence = seg(id)[1];
    const when = (word) => sentence.start + (sentence.text.indexOf(word) / sentence.text.length) * (sentence.end - sentence.start);
    await record(page, id, APP, lengthOf(id), async (at) => {
      await at(S(id, 1) - 0.2);
      await smoothScrollTo(page, '.tactics', 800);
      const names = ['authority', 'deadline', 'fear', 'proof'];
      for (let i = 0; i < names.length; i++) {
        await at(when(names[i]) - 0.1);
        await highlight(page, '.tactic', i);
        await centerOn(page, page.locator('.tactic').nth(i), 450);
      }
      await at(S(id, 2));
      await highlight(page, '.tactic .safer', 3); // "...and the safer reply"
      const span = E(id, 2) - S(id, 2);
      await at(S(id, 2) + span * 0.45);
      await highlight(page, '', -1);
      await smoothScrollTo(page, '.path', 700);
      await at(S(id, 2) + span * 0.8);
      await smoothScrollTo(page, '.habit', 700);
    });
    await ctx.close();
  },

  async S4() {
    const id = 'S4';
    const { ctx, page } = await newPage(APP);
    await playToLostDebrief(page);
    await page.locator('.actions').scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, 120));
    await record(page, id, APP, lengthOf(id), async (at) => {
      await at(E(id, 0) - 0.3); // "Same call, handled well."
      await tap(page, button(page, t('en', 'debrief.tryAgain')));
      await page.waitForSelector('.btn-reply');
      const safe = reply(page, choiceLabel('en', 'bank-call', 'n1', 'c3'));
      await at(S(id, 1) + (E(id, 1) - S(id, 1)) * 0.45); // "I hang up and call the number on my card."
      await tap(page, safe);
      await page.waitForSelector('.result');
    });
    await ctx.close();
  },

  async S5() {
    const id = 'S5';
    const { ctx, page } = await newPage(APP);
    await goHome(page);
    await record(page, id, APP, lengthOf(id), async (at) => {
      const start = page.getByRole('button', { name: startName('en', 'pos-alert') });
      await at(0.5);
      await centerOn(page, start, 900);
      await at(E(id, 0) - 0.3);
      await tap(page, start);
      await at(E(id, 1) - 0.2); // "...rushes me with an alert message."
      await tap(page, reply(page, choiceLabel('en', 'pos-alert', 'n1', 'c2')));
      await page.waitForSelector('.sms');
      await page.waitForTimeout(250);
      await smoothScrollTo(page, '.caption', 600); // show the customer line and the fake alert together
      await at(E(id, 2) - 0.2); // "I check my own banking app, not the message."
      await tap(page, reply(page, choiceLabel('en', 'pos-alert', 'n2', 'c2')));
      await page.waitForSelector('.result');
    });
    await ctx.close();
  },

  async S6() {
    const id = 'S6';
    const { ctx, page } = await newPage(APP);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
    await goHome(page);
    await record(page, id, APP, lengthOf(id), async (at) => {
      const lang = (code) => page.locator(`#lang-header .lang-btn[data-lang="${code}"]`);
      await at(0.5);
      await tap(page, lang('es'));
      await page.waitForFunction(() => document.documentElement.lang === 'es');
      const startEs = page.getByRole('button', { name: startName('es', 'bank-call') });
      await at(1.3);
      await centerOn(page, startEs, 450);
      await at(1.8);
      await tap(page, startEs);
      await page.waitForSelector('.btn-reply');
      await at(4.1); // the first Spanish caller line is on screen for about 2 s
      await tap(page, button(page, t('es', 'call.endCall')));
      await page.waitForSelector('.result');
      await at(5.2);
      await tap(page, lang('fr'));
      await page.waitForFunction(() => document.documentElement.lang === 'fr');
      await at(6.3);
      await tap(page, lang('en'));
      await page.waitForFunction(() => document.documentElement.lang === 'en');
      await at(S(id, 1) - 0.1); // "For the cloned-voice call..."
      await tap(page, page.locator('[data-i18n="nav.code"]'));
      await page.waitForSelector('#code-word');
      await at(S(id, 1) + 1.4);
      await tap(page, page.locator('#code-word'));
      await page.locator('#code-word').pressSequentially('mango', { delay: 120 });
      await at(S(id, 1) + 3.2);
      await smoothScrollTo(page, 'h2', 600);
      await at(S(id, 1) + 4.0);
      await tap(page, button(page, t('en', 'family.copy')));
      await page.waitForTimeout(300);
      await centerOn(page, page.locator('.status').first(), 500);
    });
    await ctx.close();
  },

  async S7() {
    // Evidence: recorded from the deployed site, where the real study numbers live.
    const id = 'S7';
    const base = new URL(STUDY.source).origin + '/';
    const { ctx, page } = await newPage(APP);
    await page.goto(`${base}?lang=en#/about`);
    await page.waitForSelector('.chart', { timeout: 30000 });
    const shown = await page.textContent('.chart');
    if (!shown.includes(`n = ${STUDY.n} `)) throw new Error(`S7: chart shows "${shown}", expected n = ${STUDY.n}`);
    await record(page, id, APP, lengthOf(id), async (at) => {
      await at(0.3);
      await smoothScrollTo(page, '.chart', 900);
      await at(S(id, 1));
      await highlight(page, '.bar-row', 0);
      await at(S(id, 2));
      await highlight(page, '.bar-row', 1);
      await at(S(id, 3));
      await highlight(page, '.chart figcaption em', 0);
    });
    await ctx.close();
  },

  async S8() {
    const id = 'S8';
    const { ctx, page } = await newPage(APP);
    await page.goto(`${BASE}?lang=en#/about`);
    await page.waitForSelector('.limitation');
    await record(page, id, APP, lengthOf(id), async (at) => {
      const h2 = (key) => `h2:text-is("${t('en', key)}")`;
      const top = async (key) => {
        const y = await page.locator(h2(key)).evaluate((el) => el.getBoundingClientRect().top + scrollY - 16);
        await smoothScrollTo(page, y, 900);
      };
      await at(S(id, 1) - 0.4); // "There are no accounts, nothing is stored..."
      await top('about.privacyTitle');
      await at(S(id, 2) - 0.3); // the limitation stays readable for well over 4 s
      await top('about.cannotTitle');
      await at(E(id, 3) - 2.2);
      await top('about.creditsTitle');
    });
    await ctx.close();
  },

  async S9() {
    const { ctx, page } = await newPage(CARD);
    const voice = D.voice === 'user' ? '' : cfg.voice.engine;
    const q = new URLSearchParams({ url: cfg.deployed_url, repo: cfg.repo_url, voice });
    await page.goto(`file://${path.join(DEMO, 'cards', 'end.html')}?${q}`);
    await page.waitForTimeout(300);
    await record(page, 'S9', CARD, lengthOf('S9'), async () => {});
    await ctx.close();
  },
};

// ---------- clean screenshots for the Devpost gallery ----------
async function screens() {
  const dir = path.join(OUT, 'screens');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const snap = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(dir, name) }); console.log('  screen', name); };
  let { ctx, page } = await newPage(APP);
  await goHome(page); await snap(page, '01-home.png');
  await page.getByRole('button', { name: startName('en', 'bank-call') }).tap();
  await page.waitForSelector('.btn-reply'); await page.waitForTimeout(1600); await snap(page, '02-call-in-progress.png');
  await ctx.close();
  ({ ctx, page } = await newPage(APP));
  await playToLostDebrief(page); await snap(page, '03-debrief-lost.png');
  await page.locator('.actions').scrollIntoViewIfNeeded();
  await button(page, t('en', 'debrief.tryAgain')).tap();
  await reply(page, choiceLabel('en', 'bank-call', 'n1', 'c3')).tap();
  await page.waitForSelector('.result'); await page.evaluate(() => scrollTo(0, 0)); await snap(page, '04-debrief-safe.png');
  await page.goto(`${BASE}?lang=en#/family-code`); await page.waitForSelector('#code-word');
  await page.fill('#code-word', 'mango'); await page.evaluate(() => document.activeElement.blur()); await snap(page, '05-family-code-word.png');
  await ctx.close();
  ({ ctx, page } = await newPage(APP));
  await goHome(page, 'es'); await snap(page, '06-home-spanish.png');
  await ctx.close();
}

// ---------- preflight: the app must load cleanly before anything is recorded ----------
async function preflight() {
  const { ctx, page } = await newPage(APP);
  for (const [lang, route] of [['en', '#/'], ['en', '#/drill/bank-call'], ['en', '#/about'], ['es', '#/'], ['fr', '#/drill/pos-alert'], ['en', '#/family-code']]) {
    await page.goto(`${BASE}?lang=${lang}${route}`);
    await page.waitForSelector('main h1');
    await page.waitForTimeout(400);
  }
  await ctx.close();
  if (page.errors.length) throw new Error(`Preflight console errors: ${page.errors.join(' | ')}`);
  console.log('preflight: no console errors');
}

try {
  await preflight();
  if (process.argv.includes('--screens-only')) {
    await screens();
  } else {
    const wanted = (arg('--scenes', '') || Object.keys(D.scenes).join(',')).split(',');
    for (const id of wanted) {
      if (!D.scenes[id]) throw new Error(`${id} has no narration (run tts.py${id === 'S7' ? ' --with-study' : ''})`);
      console.log(`recording ${id}`);
      await SCENES[id]();
    }
    if (!process.argv.includes('--no-screens')) await screens();
  }
} finally {
  await browser.close();
}
