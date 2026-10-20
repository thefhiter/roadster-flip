import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track, Sim, makeLevel, autopilot, EMPTY_INPUT, PRESETS, _obbOverlapsBox } from '../js/physics.js';

const DT = 1 / 240;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b} ± ${eps}, got ${a}`);

function runAutopilot(id, opts = {}, params = {}, seconds = 60) {
  const sim = new Sim(makeLevel(id), params);
  const events = [];
  for (let i = 0; i < seconds / DT && sim.mode !== 'done'; i++) {
    sim.step(DT, autopilot(sim, opts));
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

test('J-ramp geometry closes exactly where the pieces say', () => {
  const L = makeLevel('jramp');
  const { R1, H, R2, TOP } = L.dims;
  const end = L.main.pointAt(L.main.length);
  near(end.x, R1 - R2 - TOP, 1e-6, 'ceiling end x');
  near(end.y, R1 + H + R2, 1e-6, 'ceiling end y');
  near(end.tx, -1, 1e-9, 'ceiling runs leftwards');
  near(end.ny, -1, 1e-9, 'ceiling normal points down');
  const wall = L.main.pointAt(400 + (R1 * Math.PI) / 2 + H / 2);
  near(wall.x, R1, 1e-6, 'wall x');
  near(wall.nx, -1, 1e-9, 'wall faces inward');
  near(L.main.length, 400 + (R1 * Math.PI) / 2 + H + (R2 * Math.PI) / 2 + TOP, 1e-9, 'length');
});

test('Track.project returns signed distance and arc length', () => {
  const t = new Track({ start: [0, 0], pieces: [{ type: 'line', len: 10 }, { type: 'arc', radius: 5, angle: Math.PI / 2 }] });
  const q = t.project(4, 2);
  near(q.s, 4, 1e-6); near(q.dist, 2, 1e-6); assert.equal(q.inside, true);
  const below = t.project(3, -0.5);
  near(below.dist, -0.5, 1e-6);
  const beyondStart = t.project(-3, 0.2);
  assert.equal(beyondStart.inside, false);
  // a point near the arc: centre (10, 5), radius 5
  const a = t.project(10 + 5 * Math.sin(0.7) * 0.8, 5 - 5 * Math.cos(0.7) * 0.8);
  near(a.dist, 1, 0.02, 'inside the arc by 1 m');
});

test('the projection never skips the true nearest segment far from the track', () => {
  const L = makeLevel('jramp');
  for (const [x, y] of [[-30, 20], [6, 40], [-200, 15], [3, 3]]) {
    const q = L.main.project(x, y);
    let best = Infinity;
    for (let i = 0; i < L.main.xs.length; i++) best = Math.min(best, Math.hypot(x - L.main.xs[i], y - L.main.ys[i]));
    assert.ok(Math.abs(q.dist) <= best + 1e-6, `(${x},${y}) projected ${q.dist} vs brute ${best}`);
  }
});

test('coasting up a frictionless curve conserves energy', () => {
  const L = makeLevel('jramp');
  const sim = new Sim(L);
  sim.s = 395; sim.v = 20; sim.syncFromTrack();
  const e0 = 0.5 * sim.v ** 2 + 9.81 * sim.y;
  // remove rolling losses for the check
  for (let i = 0; i < 240 * 0.8; i++) {
    const v = sim.v;
    sim.step(DT, EMPTY_INPUT);
    sim.v += (Math.sign(v) * 0.25 + 0.0045 * v * Math.abs(v)) * DT;
  }
  const e1 = 0.5 * sim.v ** 2 + 9.81 * sim.y;
  near(e1, e0, e0 * 0.01, 'energy');
});

test('suction holds the car on the ceiling; releasing drops it', () => {
  const L = makeLevel('jramp');
  const sim = new Sim(L);
  sim.s = L.ceilingS0 + 2; sim.v = 4; sim.syncFromTrack();
  for (let i = 0; i < 60; i++) sim.step(DT, EMPTY_INPUT);
  assert.equal(sim.mode, 'track', 'still stuck upside down');
  sim.step(DT, { ...EMPTY_INPUT, release: true });
  assert.equal(sim.mode, 'air');
  assert.ok(sim.vy < 0, 'moving away from the ceiling');
});

test('without enough suction the ceiling throws the car off', () => {
  const L = makeLevel('jramp');
  const sim = new Sim(L, { suction: 0.5 });
  sim.s = L.ceilingS0 + 1; sim.v = 3; sim.syncFromTrack();
  sim.step(DT, EMPTY_INPUT);
  assert.equal(sim.mode, 'air');
  assert.equal(sim.drainEvents()[0].reason, 'overpowered');
});

test('Space does nothing on flat ground', () => {
  const sim = new Sim(makeLevel('jramp'));
  sim.step(DT, { ...EMPTY_INPUT, release: true, throttle: true });
  assert.equal(sim.mode, 'track');
});

function drop(level, { th = 0, vy = -6, w = 0, y = 4 } = {}) {
  const sim = new Sim(makeLevel(level));
  sim.mode = 'air';
  sim.x = -50; sim.y = y; sim.vx = 0; sim.vy = vy; sim.th = th; sim.w = w;
  for (let i = 0; i < 240 * 3 && sim.mode === 'air'; i++) sim.step(DT, EMPTY_INPUT);
  return sim;
}

test('a level, gentle touchdown is graded and snaps onto the runway', () => {
  const sim = drop('jramp', { vy: -2, y: 1.2 });
  assert.equal(sim.mode, 'track');
  assert.equal(sim.landed, true);
  assert.equal(sim.grade, 'perfect');
  near(sim.y, 0.5, 1e-6, 'COM back at ride height');
});

test('landing on the roof, crooked, or too fast is a crash', () => {
  assert.equal(drop('jramp', { th: Math.PI }).grade, 'crash');
  assert.equal(drop('jramp', { th: 0.9 }).grade, 'crash');
  assert.equal(drop('jramp', { vy: -20 }).grade, 'crash');
  assert.equal(drop('jramp', { th: 0.2, vy: -7, y: 1.6 }).grade, 'clean');
});

test('the wreck comes to rest and the run finishes', () => {
  const sim = drop('jramp', { th: Math.PI, vy: -8 });
  for (let i = 0; i < 240 * 5 && sim.mode !== 'done'; i++) sim.step(DT, EMPTY_INPUT);
  assert.equal(sim.mode, 'done');
  assert.equal(sim.result.crashed, true);
  assert.equal(sim.result.score, 0);
});

test('autopilot: J-ramp half flip lands and scores', () => {
  const { sim, events } = runAutopilot('jramp');
  assert.equal(sim.mode, 'done');
  assert.ok(events.some((e) => e.type === 'airborne' && e.reason === 'release'));
  assert.ok(['perfect', 'clean'].includes(sim.result.grade), sim.result.grade);
  near(sim.result.flips, 0.5, 0.1, 'flips');
  assert.ok(sim.result.score > 3000);
});

test('autopilot: J-ramp 1.5 flips lands', () => {
  const { sim } = runAutopilot('jramp', { spin: 1 });
  assert.notEqual(sim.result.grade, 'crash');
  near(sim.result.flips, 1.5, 0.1, 'flips');
});

test('autopilot: works in every gravity preset', () => {
  for (const name of Object.keys(PRESETS)) {
    const { sim } = runAutopilot('jramp', {}, PRESETS[name], 90);
    assert.equal(sim.mode, 'done', name);
    assert.notEqual(sim.result.grade, 'crash', `${name}: ${sim.result.reason}`);
  }
});

test('car jump: inside the target window clears all five and lands on the ramp', () => {
  const L = makeLevel('jump');
  for (const v of [L.targetSpeed[0], (L.targetSpeed[0] + L.targetSpeed[1]) / 2, L.targetSpeed[1]]) {
    const { sim, events } = runAutopilot('jump', { targetSpeed: v });
    assert.equal(sim.result.success, true, `v=${v}`);
    assert.equal(sim.result.cleared, 5);
    assert.ok(events.find((e) => e.type === 'land').surface === 'landing', `v=${v} landed on the landing ramp`);
  }
});

test('car jump: too slow hits a parked car', () => {
  const { sim } = runAutopilot('jump', { targetSpeed: 16 });
  assert.equal(sim.result.crashed, true);
  assert.equal(sim.result.reason, 'car');
  assert.ok(sim.result.cleared < 5);
});

test('box overlap test', () => {
  const box = { x: 0, y: 0, w: 4, h: 1.5 };
  assert.equal(_obbOverlapsBox(2, 1, 1, 0, box), true);
  assert.equal(_obbOverlapsBox(2, 2.2, 1, 0, box), false);
  assert.equal(_obbOverlapsBox(7, 1, 1, 0, box), false);
  // tilted 45° nose-down just above the corner
  const c = Math.cos(-Math.PI / 4), s = Math.sin(-Math.PI / 4);
  assert.equal(_obbOverlapsBox(5.6, 3.2, c, s, box), false);
  assert.equal(_obbOverlapsBox(3.8, 2.0, c, s, box), true);
});

test('fuel runs out and thrusters stop', () => {
  const sim = new Sim(makeLevel('jramp'), { fuel: 5 });
  sim.mode = 'air'; sim.x = -50; sim.y = 200; sim.vx = 0; sim.vy = 0; sim.th = 0; sim.w = 0;
  for (let i = 0; i < 240; i++) sim.step(DT, { ...EMPTY_INPUT, thrust: true });
  assert.equal(sim.fuel, 0);
  assert.equal(sim.jets.lift, 0);
});
