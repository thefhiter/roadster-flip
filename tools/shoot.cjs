// Browser smoke test + screenshot capture.
// Plays both levels through the real keyboard handlers (the autopilot's
// decisions are turned into key presses inside the page), checks for console
// errors, and writes screenshots to tools/out/ (and docs/ with --docs).
//
//   NODE_PATH=<dir containing playwright> node tools/shoot.cjs [--docs] [--url=http://localhost:9112]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const URL = (args.find((a) => a.startsWith('--url=')) || '--url=http://localhost:9112').slice(6);
const DOCS = args.includes('--docs');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
if (DOCS) fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function shot(page, name, docName) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  if (DOCS && docName) fs.copyFileSync(file, path.join(__dirname, '..', 'docs', `${docName}.png`));
}

// Drive the game with key presses decided by the autopilot, inside the page.
async function startBot(page, opts) {
  await page.evaluate(async (opts) => {
    const { autopilot } = await import(new URL('js/physics.js', location.href).href);
    const g = window.__game;
    const map = { throttle: 'up', thrust: 'up', brake: 'down', left: 'left', right: 'right', boost: 'boost' };
    window.__botLog = [];
    window.__bot = setInterval(() => {
      const sim = g.sim;
      if (g.state !== 'play') return;
      const inp = autopilot(sim, opts);
      const want = { up: false, down: false, left: false, right: false, boost: false };
      for (const k in map) if (inp[k]) want[map[k]] = true;
      for (const k in want) g.press(k, want[k]);
      if (inp.release) { g.press('release', true); setTimeout(() => g.press('release', false), 30); }
    }, 8);
  }, opts);
}
const stopBot = (page) => page.evaluate(() => { clearInterval(window.__bot); for (const k of ['up', 'down', 'left', 'right', 'boost', 'release']) window.__game.press(k, false); });
const simState = (page) => page.evaluate(() => { const s = window.__game.sim; return { mode: s.mode, x: s.x, y: s.y, landed: s.landed, grade: s.grade, rot: s.rot, air: s.airTime, state: window.__game.state, fuel: s.fuel }; });
async function waitFor(page, pred, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await simState(page);
    if (pred(s)) return s;
    await sleep(50);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(3500);
  check('title screen visible', await page.isVisible('#title'));
  check('attract demo is running', (await simState(page)).x !== 0);
  await shot(page, '01-title', 'title');

  // FPS sample
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  check('renders frames', fps > 5, `${fps.toFixed(0)} fps (headless)`);

  // slow time so headless frame pacing cannot outrun the bot
  await page.evaluate(() => window.__game.setTimeScale(0.5));

  // ── J-ramp ──
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Enter');
  await sleep(300);
  check('Enter starts a run', (await simState(page)).state === 'play');
  await startBot(page, { spin: 0 });
  let s = await waitFor(page, (s) => s.y > 15 && s.mode === 'track', 40000);
  check('car climbs the wall on suction', !!s, s ? `y=${s.y.toFixed(1)}` : '');
  await shot(page, '02-wall', 'climb');
  s = await waitFor(page, (s) => s.mode === 'air' && s.air > 0.5, 30000);
  check('lets go from the ceiling', !!s);
  await sleep(150);
  await shot(page, '03-flip', 'flip');
  s = await waitFor(page, (s) => s.mode === 'air' && s.y < 8 && s.air > 1, 30000);
  await shot(page, '04-thrusters', 'thrusters');
  s = await waitFor(page, (s) => s.landed || s.mode === 'crash' || s.mode === 'done', 30000);
  check('lands', s && s.landed && s.grade !== 'crash', s ? s.grade : 'timeout');
  s = await waitFor(page, (s) => s.state === 'result', 30000);
  check('result card shows', !!s && (await page.isVisible('#result')));
  await sleep(500);
  await shot(page, '05-result', 'result');
  const score = await page.textContent('#result-score');
  check('score is positive', parseInt(score.replace(/\D/g, ''), 10) > 0, score);
  await stopBot(page);

  // ── Car jump ──
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc on result returns to menu', await page.isVisible('#title'));
  await page.click('.mode[data-level="jump"]');
  await sleep(2500);
  await shot(page, '06-jump-title');
  await page.click('#btn-start');
  await startBot(page, {});
  s = await waitFor(page, (s) => s.mode === 'air' && s.x > 18, 40000);
  check('car jump launches over the cars', !!s);
  await shot(page, '07-jump-air', 'jump');
  s = await waitFor(page, (s) => s.state === 'result', 40000);
  const jumpTitle = await page.textContent('#result-h');
  check('car jump result', !!s && !/Crashed|short/i.test(jumpTitle), jumpTitle);
  await sleep(400);
  await shot(page, '08-jump-result');
  await stopBot(page);

  // ── crash path: drive into the ceiling release and do nothing ──
  await page.keyboard.press('Digit1');
  await sleep(300);
  await page.evaluate(() => { const g = window.__game; g.start(); const s = g.sim; s.mode = 'air'; s.x = -40; s.y = 12; s.vx = -8; s.vy = -4; s.th = Math.PI; s.w = 0; });
  s = await waitFor(page, (s) => s.mode === 'crash', 15000);
  check('roof landing crashes', !!s);
  await sleep(300);
  await shot(page, '09-crash');
  s = await waitFor(page, (s) => s.state === 'result', 20000);
  check('crash result says Crashed', /Crashed/.test(await page.textContent('#result-h')));

  // ── tuning panel ──
  await page.keyboard.press('KeyR');
  await sleep(300);
  await page.keyboard.press('KeyT');
  await sleep(300);
  check('tune panel opens and pauses', (await page.isVisible('#tune')) && (await simState(page)).state === 'paused');
  await page.click('[data-preset="moon"]');
  const g = await page.evaluate(() => window.__game.sim.params.gravity);
  check('moon preset applies', Math.abs(g - 1.62) < 1e-6, `g=${g}`);
  await shot(page, '10-tune', 'tune');
  await page.click('[data-preset="earth"]');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc closes tuning and resumes', !(await page.isVisible('#tune')) && (await simState(page)).state === 'play');

  // ── pause ──
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc pauses', await page.isVisible('#pause'));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc resumes', !(await page.isVisible('#pause')));

  // ── mobile ──
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile: ' + e));
  await mp.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3000);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('mobile: no horizontal overflow', !overflow);
  await mp.screenshot({ path: path.join(out, '11-mobile-title.png') });
  if (DOCS) fs.copyFileSync(path.join(out, '11-mobile-title.png'), path.join(__dirname, '..', 'docs', 'mobile.png'));
  await mp.tap('#btn-start');
  await sleep(600);
  check('mobile: touch controls show', await mp.isVisible('.touch button.gas'));
  const box = await mp.locator('.touch button.gas').boundingBox();
  check('mobile: touch targets ≥ 44px', box && box.width >= 44 && box.height >= 44, box ? `${box.width}×${box.height}` : '');
  await mp.dispatchEvent('.touch button.gas', 'pointerdown', { pointerId: 1 });
  await sleep(1500);
  const v = await mp.evaluate(() => window.__game.sim.v);
  check('mobile: gas button drives', v > 3, `v=${v.toFixed(1)}`);
  await mp.screenshot({ path: path.join(out, '12-mobile-play.png') });

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
