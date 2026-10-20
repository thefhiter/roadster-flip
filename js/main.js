import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sim, makeLevel, autopilot, DEFAULT_PARAMS, PRESETS, EMPTY_INPUT, CAR } from './physics.js';
import { buildRoadster, applyPaint, PAINTS } from './car.js';
import { buildWorld } from './world.js';
import { Particles } from './fx.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// ─── renderer, scene, post ──────────────────────────────────────────────────
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  const f = $('fatal');
  f.hidden = false;
  f.textContent = 'WebGL is not available in this browser, so the game cannot start.';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a09);
scene.fog = new THREE.FogExp2(0x0a0a09, 0.0062);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envMap;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 1600);
camera.position.set(-20, 12, 60);

scene.add(new THREE.HemisphereLight(0xa8b0bc, 0x060606, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -34;
key.shadow.camera.right = key.shadow.camera.top = 34;
key.shadow.camera.near = 1;
key.shadow.camera.far = 160;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9fb2ff, 0.7);
rim.position.set(30, 20, -40);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 1.35);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const fx = new Particles(scene);
const sound = new Sound();
document.body.classList.toggle('muted', sound.muted);

// ─── levels + car ───────────────────────────────────────────────────────────
const levels = { jramp: makeLevel('jramp'), jump: makeLevel('jump') };
const worlds = {};
for (const id in levels) {
  worlds[id] = buildWorld(scene, levels[id]);
  worlds[id].visible = false;
}
let paintName = store.get('roadster.paint', 'white');
if (!PAINTS[paintName]) paintName = 'white';
const car = buildRoadster(envMap, paintName);
scene.add(car.root);

let params = { ...DEFAULT_PARAMS, ...store.get('roadster.params', {}) };
let bloomStrength = store.get('roadster.bloom', 0.45);
bloom.strength = bloomStrength;
let levelId = store.get('roadster.level', 'jramp');
if (!levels[levelId]) levelId = 'jramp';
let sim = new Sim(levels[levelId], params);

// app state: title | play | result | paused
let state = 'title';
let demoRun = 0;
let demoOpts = {};
let resultTimer = 0;
let slowmo = 1;
let shake = 0;

// visual-only springs on the car body
const vis = { pitch: 0, pitchV: 0, squash: 0, squashV: 0, wheelSpin: 0 };
const jetLevels = new Map();

// ─── input ──────────────────────────────────────────────────────────────────
const held = { up: false, down: false, left: false, right: false, boost: false, release: false };
let releasePressed = false;
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'release',
};

function press(name, down) {
  if (name === 'release' && down && !held.release) releasePressed = true;
  held[name] = down;
}

function playerInput() {
  const inp = { ...EMPTY_INPUT };
  if (sim.mode === 'track') {
    inp.throttle = held.up;
    inp.brake = held.down;
  } else {
    inp.thrust = held.up;
  }
  inp.left = held.left;
  inp.right = held.right;
  inp.boost = held.boost;
  inp.release = releasePressed;
  return inp;
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = KEYMAP[e.code];
  if (k && state === 'play') {
    e.preventDefault();
    if (!e.repeat) press(k, true);
    return;
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Enter':
      if (state === 'title' || state === 'result') { e.preventDefault(); startRun(); }
      break;
    case 'Escape': case 'KeyP':
      if (!$('tune').hidden) closeTune();
      else if (state === 'play') pause();
      else if (state === 'paused') resume();
      else if (state === 'result') showTitle();
      break;
    case 'KeyR':
      if (state === 'play' || state === 'result' || state === 'paused') startRun();
      break;
    case 'KeyT': toggleTune(); break;
    case 'KeyM': toggleMute(); break;
    case 'Digit1': selectLevel('jramp', state !== 'title'); break;
    case 'Digit2': selectLevel('jump', state !== 'title'); break;
  }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) press(k, false);
});
window.addEventListener('blur', () => { for (const k in held) held[k] = false; });

// touch pads
for (const b of document.querySelectorAll('.touch button')) {
  const k = b.dataset.key;
  const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('held'); press(k, true); sound.unlock(); };
  const off = () => { b.classList.remove('held'); press(k, false); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
}

// ─── UI wiring ──────────────────────────────────────────────────────────────
$('btn-start').addEventListener('click', startRun);
$('btn-retry').addEventListener('click', startRun);
$('btn-menu').addEventListener('click', showTitle);
$('btn-restart').addEventListener('click', () => { startRun(); $('btn-restart').blur(); });
$('btn-pause').addEventListener('click', () => (state === 'paused' ? resume() : pause()));
$('btn-resume').addEventListener('click', resume);
$('btn-pause-menu').addEventListener('click', showTitle);
$('btn-tune').addEventListener('click', toggleTune);
$('btn-tune-close').addEventListener('click', closeTune);
$('btn-sound').addEventListener('click', toggleMute);
for (const b of document.querySelectorAll('[data-level]')) {
  b.addEventListener('click', () => {
    selectLevel(b.dataset.level, state !== 'title');
    b.blur();
  });
}
window.addEventListener('pointerdown', () => sound.unlock(), { once: false });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

function setState(s) {
  state = s;
  document.body.dataset.state = s;
  $('title').hidden = s !== 'title';
  $('result').hidden = s !== 'result';
  $('pause').hidden = s !== 'paused';
}

function selectLevel(id, restart) {
  if (!levels[id]) return;
  levelId = id;
  store.set('roadster.level', id);
  for (const b of document.querySelectorAll('.level-tab')) b.setAttribute('aria-pressed', String(b.dataset.level === id));
  for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-checked', String(b.dataset.level === id));
  for (const w in worlds) worlds[w].visible = w === id;
  sim = new Sim(levels[id], params);
  fx.clear();
  snapCamera = true;
  if (restart) startRun();
  else { demoRun = 0; newDemo(); }
  sound.play('tick');
}

function startRun() {
  sound.unlock();
  closeTune(true);
  sim = new Sim(levels[levelId], params);
  fx.clear();
  vis.pitch = vis.pitchV = vis.squash = vis.squashV = 0;
  resultTimer = 0;
  slowmo = 1;
  lastRotMark = 0;
  for (const k in held) held[k] = false;
  releasePressed = false;
  setState('play');
  callout('');
  $('btn-start').blur();
}

function showTitle() {
  closeTune(true);
  setState('title');
  sim = new Sim(levels[levelId], params);
  newDemo();
  renderBest();
  $('btn-start').focus({ preventScroll: true });
}

function pause() { if (state === 'play') { setState('paused'); $('btn-resume').focus(); } }
function resume() { if (state === 'paused') { setState('play'); $('btn-resume').blur(); } }

function toggleMute() {
  sound.unlock();
  sound.setMuted(!sound.muted);
  document.body.classList.toggle('muted', sound.muted);
  $('btn-sound').setAttribute('aria-label', sound.muted ? 'Unmute sound (M)' : 'Mute sound (M)');
}

let tuneWasPlaying = false;
function toggleTune() { if ($('tune').hidden) openTune(); else closeTune(); }
function openTune() {
  $('tune').hidden = false;
  tuneWasPlaying = state === 'play';
  if (tuneWasPlaying) setState('paused');
  $('pause').hidden = true;
  $('tune').querySelector('input, button').focus();
}
function closeTune(silent) {
  if ($('tune').hidden) return;
  $('tune').hidden = true;
  if (!silent && tuneWasPlaying && state === 'paused') setState('play');
  tuneWasPlaying = false;
}

// ─── tuning sliders ─────────────────────────────────────────────────────────
const SLIDERS = [
  { key: 'gravity', label: 'Gravity', min: 1, max: 20, step: 0.01, fmt: (v) => `${v.toFixed(2)} m/s²` },
  { key: 'motor', label: 'Motor power', min: 0.4, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'suction', label: 'Suction grip', min: 0, max: 4, step: 0.1, fmt: (v) => `${v.toFixed(1)} g` },
  { key: 'thrust', label: 'Thruster power', min: 0.5, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fuel', label: 'Gas tank', min: 20, max: 300, step: 5, fmt: (v) => `${Math.round(v)}` },
  { key: 'timeScale', label: 'Time scale', min: 0.2, max: 1, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'bloom', label: 'Glow', min: 0, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) },
];
const sliderEls = {};
for (const s of SLIDERS) {
  const id = `sl-${s.key}`;
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  wrap.innerHTML = `<label for="${id}"><span>${s.label}</span><output id="${id}-out" for="${id}"></output></label>
    <input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}">`;
  $('sliders').append(wrap);
  const input = wrap.querySelector('input');
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (s.key === 'bloom') { bloomStrength = v; bloom.strength = v; store.set('roadster.bloom', v); }
    else { params[s.key] = v; applyParams(); }
    syncSliders();
  });
  sliderEls[s.key] = input;
}
for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => {
    params = { ...params, ...PRESETS[b.dataset.preset] };
    applyParams();
    syncSliders();
  });
}
for (const b of document.querySelectorAll('[data-paint]')) {
  b.addEventListener('click', () => {
    paintName = b.dataset.paint;
    applyPaint(car.paint, paintName);
    store.set('roadster.paint', paintName);
    syncSliders();
  });
}
function applyParams() {
  store.set('roadster.params', params);
  sim.setParams(params);
}
function syncSliders() {
  for (const s of SLIDERS) {
    const v = s.key === 'bloom' ? bloomStrength : params[s.key];
    sliderEls[s.key].value = v;
    $(`sl-${s.key}-out`).textContent = s.fmt(v);
  }
  for (const b of document.querySelectorAll('[data-paint]')) b.setAttribute('aria-pressed', String(b.dataset.paint === paintName));
  for (const b of document.querySelectorAll('[data-preset]')) {
    const p = PRESETS[b.dataset.preset];
    const match = Object.keys(p).every((k) => Math.abs(p[k] - params[k]) < 1e-6);
    b.setAttribute('aria-pressed', String(match));
  }
}
syncSliders();

// ─── HUD ────────────────────────────────────────────────────────────────────
const hud = {
  speed: $('t-speed'), alt: $('t-alt'), air: $('t-air'), rot: $('t-rot'),
  fuel: $('t-fuel'), fuelFill: $('fuel-fill'), fuelBar: $('fuel-bar'),
  chip: $('chip-suction'), chipText: $('suction-text'), hint: $('hint'),
  target: $('t-target'), window: $('t-window'), windowState: $('t-window-state'),
};
let hudClock = 0;
let lastHint = '';
let lastRotMark = 0;

function updateHud(dt) {
  hudClock += dt;
  if (hudClock < 1 / 20) return;
  hudClock = 0;
  const kmh = sim.speed * 3.6;
  hud.speed.textContent = Math.round(kmh);
  hud.alt.textContent = Math.max(0, sim.altitude).toFixed(1);
  hud.air.textContent = sim.airTime.toFixed(2);
  hud.rot.textContent = Math.round(Math.abs(sim.rot) * 180 / Math.PI);
  const pct = Math.round((sim.fuel / params.fuel) * 100);
  hud.fuel.textContent = `${pct}%`;
  hud.fuelFill.style.transform = `scaleX(${sim.fuel / params.fuel})`;
  hud.fuelBar.setAttribute('aria-valuenow', pct);
  hud.fuelBar.classList.toggle('low', pct < 25);

  const L = sim.level;
  const suctionOn = sim.mode === 'track' && sim.suction;
  hud.chip.classList.toggle('on', suctionOn);
  hud.chip.hidden = !L.suction;
  hud.chipText.textContent = suctionOn ? 'Suction on' : 'Suction off';

  if (L.targetSpeed) {
    hud.target.hidden = false;
    const [a, b] = L.targetSpeed;
    hud.window.textContent = `${Math.round(a * 3.6)}–${Math.round(b * 3.6)}`;
    const inWin = sim.mode === 'track' && !sim.landed && sim.speed >= a && sim.speed <= b;
    hud.target.classList.toggle('in', inWin);
    hud.windowState.textContent = inWin ? 'km/h · in window' : 'km/h';
  } else hud.target.hidden = true;

  setHint(hintText());
}

function hintText() {
  const L = sim.level;
  if (sim.mode === 'air') return '<kbd>←</kbd><kbd>→</kbd> rotate · <kbd>↑</kbd> lift thrusters · land wheels-down';
  if (sim.mode === 'crash' || sim.mode === 'done') return '<kbd>R</kbd> to retry';
  if (sim.landed) return 'Rolling out…';
  if (L.id === 'jramp') {
    if (sim.surf === L.main && sim.s > L.ceilingS0 - 1) return '<kbd>Space</kbd> let go!';
    if (sim.s > L.rampS0) return 'Keep <kbd>↑</kbd> on — suction holds you to the wall';
    return 'Hold <kbd>↑</kbd> to drive · climb the ramp';
  }
  if (sim.v < 2) return 'Hold <kbd>↑</kbd> to drive · <kbd>Shift</kbd> boost';
  return 'Hit the kicker inside the speed window · <kbd>↓</kbd> to brake';
}

function setHint(h) {
  if (h === lastHint) return;
  lastHint = h;
  hud.hint.innerHTML = h;
}

let calloutTimer = 0;
function callout(text, sub = '', accent = false) {
  const el = $('callout');
  clearTimeout(calloutTimer);
  if (!text) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="pop${accent ? ' accent' : ''}">${text}${sub ? `<small>${sub}</small>` : ''}</span>`;
  calloutTimer = setTimeout(() => { el.innerHTML = ''; }, 1500);
}

function renderBest() {
  for (const el of document.querySelectorAll('[data-best]')) {
    const b = store.get(`roadster.best.${el.dataset.best}`, 0);
    el.textContent = b ? b.toLocaleString() : '—';
  }
}
renderBest();

const GRADE_TITLE = { perfect: 'Perfect landing', clean: 'Clean landing', rough: 'Rough landing' };
const CRASH_TEXT = {
  roof: 'Landed on the roof', angle: 'Came down crooked', hard: 'Hit the ground too hard',
  spin: 'Still spinning at touchdown', car: 'Hit a parked car', lost: 'Lost in the dark',
};

function showResult(r) {
  const L = sim.level;
  $('result-level').textContent = L.title;
  const h = $('result-h');
  let title, sub;
  if (r.crashed) {
    title = 'Crashed';
    sub = CRASH_TEXT[r.reason] || 'Wrecked';
  } else if (L.id === 'jump' && !r.success) {
    title = 'Came up short';
    sub = `Cleared ${r.cleared} of ${L.obstacles.length} cars`;
  } else {
    title = GRADE_TITLE[r.grade];
    sub = L.id === 'jramp'
      ? `${flipName(r.flips)} · ${r.airTime.toFixed(2)} s air · ${Math.round(r.maxAlt)} m drop`
      : `All ${L.obstacles.length} cars cleared · top speed ${Math.round(r.topSpeed * 3.6)} km/h`;
  }
  h.textContent = title;
  h.classList.toggle('crash', r.crashed);
  $('result-sub').textContent = sub;
  const scored = r.crashed || (L.id === 'jump' && !r.success) ? 0 : r.score;
  $('result-score').textContent = scored.toLocaleString();
  const bestKey = `roadster.best.${L.id}`;
  const best = store.get(bestKey, 0);
  const best$ = $('result-best');
  if (scored > best) {
    store.set(bestKey, scored);
    best$.textContent = 'New best';
    best$.classList.add('new');
  } else {
    best$.textContent = `Best ${best.toLocaleString()}`;
    best$.classList.remove('new');
  }
  const cap = (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1);
  const rows = r.items.map(([k, v, pts]) => `<tr><td>${k}</td><td>${cap(v)}</td><td>+${pts.toLocaleString()}</td></tr>`).join('');
  $('result-rows').innerHTML = rows || '<tr><td>No score this run</td><td></td><td></td></tr>';
  setState('result');
  renderBest();
  $('btn-retry').focus({ preventScroll: true });
}

function flipName(f) {
  const halves = Math.round(f * 2) / 2;
  if (halves < 0.5) return 'No flip';
  if (halves === 0.5) return 'Half flip';
  if (halves === 1) return '1 flip';
  return `${halves} flips`;
}

// ─── events from the sim ────────────────────────────────────────────────────
function handleEvents(live) {
  for (const e of sim.drainEvents()) {
    switch (e.type) {
      case 'airborne':
        if (!live) break;
        if (e.reason === 'release') { callout('Let go'); sound.play('release'); if (!reduceMotion) slowmo = 0.4; }
        else if (e.reason === 'overpowered') callout('Suction lost', '', true);
        else if (e.reason === 'lip') sound.play('release');
        break;
      case 'land': {
        const s = Math.min(1.6, e.impact / 7 + 0.3);
        vis.pitch = e.angle;
        vis.squashV -= e.impact * 0.06;
        shake = Math.max(shake, e.impact * 0.05);
        const b = bottomCenter();
        fx.dust(b.x, b.y, 0, s);
        if (live) {
          sound.play('land', s);
          const flips = Math.abs(sim.rot) / (Math.PI * 2);
          callout(GRADE_TITLE[e.grade], sim.level.id === 'jramp' ? flipName(flips) : `${sim.cleared.size}/${sim.level.obstacles.length} cars`, e.grade === 'perfect');
          if (e.grade !== 'rough') sound.play('success');
        }
        break;
      }
      case 'crash':
        shake = Math.max(shake, 0.9);
        fx.sparks(sim.x, sim.y - 0.3, 0, 1.4);
        fx.dust(sim.x, Math.max(0, sim.y - 0.5), 0, 1.2);
        if (live) { sound.play('crash'); callout('Crashed', CRASH_TEXT[e.reason] || '', true); }
        break;
      case 'impact':
        fx.sparks(e.x, e.y, 0, Math.min(1.2, e.strength / 6));
        if (live) sound.play('impact', e.strength / 5);
        break;
      case 'clear':
        if (live) { sound.play('clear', e.count); if (e.count === sim.level.obstacles.length) callout('All clear', `${e.count}/${e.count}`); }
        break;
      case 'done':
        if (live) resultTimer = 0.9;
        else demoEndTimer = 2.2;
        break;
    }
  }
}

function bottomCenter() {
  return { x: sim.x + Math.sin(sim.th) * CAR.comY, y: sim.y - Math.cos(sim.th) * CAR.comY };
}

// ─── title-screen demo (autopilot) ──────────────────────────────────────────
let demoEndTimer = 0;
function newDemo() {
  sim = new Sim(levels[levelId], params);
  fx.clear();
  demoRun++;
  // alternate a half flip and a 1.5 flip on the J-ramp, vary jump speed
  demoOpts = levelId === 'jramp'
    ? { spin: demoRun % 2 === 0 ? 1 : 0 }
    : { targetSpeed: [20.8, 22.5, 26][demoRun % 3] };
  // start the demo close to the action
  sim.s = levelId === 'jramp' ? levels.jramp.rampS0 - 60 : levels.jump.rampS0 - 55;
  sim.v = levelId === 'jramp' ? 26 : 20;
  sim.syncFromTrack();
  demoEndTimer = 0;
}

// ─── camera ─────────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3(-20, 12, 60);
const camLook = new THREE.Vector3();
const CAM_DIR = new THREE.Vector3(-0.3, 0.13, 1).normalize();
let focusBlend = 0;
let snapCamera = true;
let filmOffset = 0;

function updateCamera(dt) {
  const L = sim.level;
  const lead = THREE.MathUtils.clamp(sim.vx * 0.25, -8, 8);
  const box = { minX: sim.x - 7 + Math.min(0, lead), maxX: sim.x + 7 + Math.max(0, lead), minY: sim.y - 3, maxY: sim.y + 3.5 };
  // pull the whole ramp into frame while the stunt is happening
  const near = sim.x > L.focusFrom && sim.x < L.focus.maxX + 30;
  const want = (sim.mode === 'air' || (sim.mode === 'track' && !sim.landed && near) || (sim.mode !== 'track' && near)) ? 1 : sim.landed ? 0.35 : 0;
  focusBlend += (want - focusBlend) * (1 - Math.exp(-dt * 1.6));
  const f = L.focus, w = focusBlend;
  box.minX = Math.min(box.minX, box.minX + (f.minX - box.minX) * w);
  box.maxX = Math.max(box.maxX, box.maxX + (f.maxX - box.maxX) * w);
  box.minY = Math.min(box.minY, box.minY + (f.minY - box.minY) * w);
  box.maxY = Math.max(box.maxY, box.maxY + (f.maxY - box.maxY) * w);
  box.minY = Math.max(box.minY, -1);

  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const titleScale = state === 'title' && camera.aspect > 1 ? 1.45 : 1;
  const need = Math.max((box.maxY - box.minY) * 1.25, ((box.maxX - box.minX) * 1.18 * titleScale) / camera.aspect);
  const dist = Math.max(16, need / 2 / halfH);
  const goal = new THREE.Vector3(cx, cy, 0).addScaledVector(CAM_DIR, dist);
  goal.y = Math.max(goal.y, 1.5);
  const k = snapCamera ? 1 : 1 - Math.exp(-dt * 2.6);
  camPos.lerp(goal, k);
  camLook.lerp(new THREE.Vector3(cx, cy, 0), k);
  snapCamera = false;

  camera.position.copy(camPos);
  const ov = window.__camOverride;
  if (ov) { camera.position.set(...ov.pos); camLook.set(...ov.look); }
  if (shake > 0.001 && !reduceMotion) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }
  shake *= Math.exp(-dt * 5);
  camera.lookAt(camLook);

  // on the title screen, slide the picture right so the type has room
  const fo = state === 'title' && camera.aspect > 1.1 ? -9 : 0;
  filmOffset += (fo - filmOffset) * (1 - Math.exp(-dt * 3));
  if (Math.abs(camera.filmOffset - filmOffset) > 0.001) { camera.filmOffset = filmOffset; camera.updateProjectionMatrix(); }

  key.position.set(sim.x - 25, sim.y + 55, 40);
  key.target.position.set(sim.x, Math.max(0, sim.y - 5), 0);
}

// ─── car visuals ────────────────────────────────────────────────────────────
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpD = new THREE.Vector3();
const JET_RATE = { lift: 170, boost: 130, noseUp: 70, noseDown: 70 };

function updateCar(dt) {
  car.root.position.set(sim.x, sim.y, 0);
  car.root.rotation.z = sim.th;
  // springs: landing pitch settles, suspension squash
  vis.pitchV += (-vis.pitch * 90 - vis.pitchV * 14) * dt;
  vis.pitch += vis.pitchV * dt;
  vis.squashV += (-vis.squash * 220 - vis.squashV * 16) * dt;
  vis.squash += vis.squashV * dt;
  vis.squash = Math.max(-0.22, Math.min(0.12, vis.squash));
  car.body.rotation.z = vis.pitch;
  car.body.position.y = -0.5 + vis.squash;

  const onGround = sim.mode === 'track';
  vis.wheelSpin = onGround ? sim.v / car.wheelRadius : vis.wheelSpin * Math.exp(-dt * 0.6);
  for (const w of car.wheels) w.rotation.z -= vis.wheelSpin * dt;

  car.root.updateMatrixWorld();
  car.body.getWorldQuaternion(tmpQ);
  let liftLevel = 0;
  for (const j of car.jets) {
    const target = sim.jets[j.channel] || 0;
    const lvl = (j.level += (target - j.level) * (1 - Math.exp(-dt * (target > j.level ? 30 : 14))));
    if (j.channel === 'lift') liftLevel = Math.max(liftLevel, lvl);
    j.mesh.visible = lvl > 0.02;
    if (!j.mesh.visible) continue;
    const flicker = 0.85 + Math.random() * 0.3;
    j.mesh.scale.set(j.width * (0.8 + 0.2 * lvl), j.length * lvl * flicker, j.width * (0.8 + 0.2 * lvl));
    j.mat.opacity = 0.65 * lvl;
    // smoke from the nozzle
    const rate = JET_RATE[j.channel] * lvl * dt;
    const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    if (n) {
      j.mesh.getWorldPosition(tmpV);
      tmpD.copy(j.dir).applyQuaternion(tmpQ);
      for (let i = 0; i < n; i++) {
        const sp = 12 + Math.random() * 8;
        fx.spawn(tmpV.x, tmpV.y, tmpV.z,
          tmpD.x * sp + sim.vx * 0.5 + (Math.random() - 0.5) * 2,
          tmpD.y * sp + sim.vy * 0.5 + (Math.random() - 0.5) * 2,
          tmpD.z * sp + (Math.random() - 0.5) * 3,
          { life: j.channel === 'lift' ? 2 : 1.3, size: 1.0, grow: j.channel === 'lift' ? 4.2 : 3, alpha: 0.2 });
      }
    }
  }
  car.jetLight.intensity = liftLevel * 45;
  // lift jets near the ground kick up dust
  if (liftLevel > 0.3 && sim.altitude < 7 && Math.random() < dt * 30) {
    const b = bottomCenter();
    fx.spawn(b.x + (Math.random() - 0.5) * 2, 0.3, (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 14, 0.6, (Math.random() - 0.5) * 14,
      { life: 1.6, size: 1.2, grow: 3, alpha: 0.28 * (1 - sim.altitude / 7), color: [0.6, 0.6, 0.6] });
  }
}

// ─── main loop ──────────────────────────────────────────────────────────────
const DT = 1 / 240;
let acc = 0;
let last = performance.now();

function frame(now) {
  // rAF timestamps can precede the last reading (first frame, tab wake-up), so
  // clamp both ways; a negative step would push the camera away and stall physics
  const real = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const live = state === 'play';
  const running = state === 'play' || state === 'title' || state === 'result';
  slowmo += (1 - slowmo) * (1 - Math.exp(-real * 1.8));
  const dt = running ? real * params.timeScale * (live ? slowmo : 1) : 0;
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 60) {
    const inp = live ? playerInput() : state === 'title' ? autopilot(sim, demoOpts) : EMPTY_INPUT;
    sim.step(DT, inp);
    if (live) releasePressed = false;
    handleEvents(live);
    acc -= DT;
    steps++;
  }
  if (steps === 60) acc = 0;

  // rotation milestones every half turn
  if (live && sim.mode === 'air') {
    const mark = Math.floor(Math.abs(sim.rot) / Math.PI + 0.1);
    if (mark > lastRotMark) { lastRotMark = mark; if (mark >= 2) { callout(`${mark * 180}°`); sound.play('flip'); } }
  }

  if (resultTimer > 0) { resultTimer -= real; if (resultTimer <= 0 && state === 'play') showResult(sim.result); }
  if (state === 'title' && demoEndTimer > 0) { demoEndTimer -= real; if (demoEndTimer <= 0) newDemo(); }

  updateCar(dt);
  fx.update(dt, params.gravity);
  updateCamera(real);
  if (live) updateHud(real);
  sound.update({
    speed: sim.speed,
    throttle: live && sim.mode === 'track' && held.up ? 1 : 0,
    jets: Math.max(sim.jets.lift, sim.jets.boost * 0.8, Math.max(sim.jets.noseUp, sim.jets.noseDown) * 0.45),
    air: sim.mode === 'air',
    active: live || state === 'result',
  });
  composer.render();
  window.__roadster = { sim, state, camera };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fx.setViewport(h * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

// boot
selectLevel(levelId, false);
setState('title');
renderer.setAnimationLoop(frame);

// test / debug hooks
window.__game = {
  start: startRun, title: showTitle, selectLevel,
  press, get sim() { return sim; }, get state() { return state; },
  setTimeScale(v) { params.timeScale = v; },
};
