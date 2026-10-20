// Roadster Flip — 2D physics core.
//
// The game is simulated in the vertical X/Y plane and rendered in 3D.
// This module has no rendering dependency so it can be unit-tested in Node.
//
// Conventions
//   x → right, y → up, metres, seconds, radians.
//   Car heading `th` is the angle of its forward axis. Its "up" axis is
//   forward rotated +90°. Tracks carry a left normal n = (-ty, tx): the side
//   the car rides on.

export const DEFAULT_PARAMS = Object.freeze({
  gravity: 9.81,   // m/s²
  motor: 1,        // motor power multiplier
  suction: 2.2,    // suction grip, in multiples of g
  thrust: 1,       // cold-gas thruster multiplier
  fuel: 100,       // cold-gas tank
  timeScale: 1,
});

export const PRESETS = Object.freeze({
  earth:  { gravity: 9.81, motor: 1,    suction: 2.2, thrust: 1,    fuel: 100 },
  moon:   { gravity: 1.62, motor: 0.55, suction: 2.2, thrust: 1,    fuel: 100 },
  mars:   { gravity: 3.71, motor: 0.75, suction: 2.2, thrust: 1,    fuel: 100 },
  arcade: { gravity: 12,   motor: 1.4,  suction: 3,   thrust: 1.35, fuel: 160 },
});

// Car body in its own frame, relative to the centre of mass.
// The COM sits COM_Y above the wheel contact line.
export const CAR = Object.freeze({
  halfLen: 2.15,
  comY: 0.5,
  // corners: bottom-rear, bottom-front, top-front, top-rear
  corners: [[-2.15, -0.5], [2.15, -0.5], [1.95, 0.55], [-2.05, 0.5]],
  inertia: 1.66,   // per unit mass, (L² + H²) / 12
});

const MOTOR_ACCEL = 14;     // m/s² launch limit (0-100 km/h ≈ 2 s)
const MOTOR_POWER = 400;    // W/kg, so accel = P / v at speed
const BRAKE = 16;
const REVERSE = 5;
const ROLL = 0.25;
const DRAG = 0.0045;
const AIR_DRAG = 0.0015;
const LIFT_G = 2.6;         // lift thrusters, multiples of g
const BOOST = 11;           // m/s²
const ALPHA = 7;            // rad/s² from the pitch thrusters
const FUEL_LIFT = 28, FUEL_BOOST = 22, FUEL_PITCH = 9;   // units/s
const LAND_MAX_VN = 13;     // suspension limit, m/s into the surface
const LAND_MAX_ANGLE = 0.62;
const LAND_MAX_SPIN = 4.5;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ─── Track ──────────────────────────────────────────────────────────────────

// A track is built like a turtle path from line and arc pieces, then sampled
// into a dense polyline. Arc `angle` is signed: positive turns left (CCW).
export class Track {
  constructor({ name = 'track', start = [0, 0], heading = 0, pieces, step = 0.25, visible = true }) {
    this.name = name;
    this.visible = visible;
    const xs = [start[0]], ys = [start[1]], hs = [heading], ss = [0], ks = [];
    let x = start[0], y = start[1], h = heading, s = 0;
    this.pieces = [];
    for (const piece of pieces) {
      const len = piece.type === 'line' ? piece.len : Math.abs(piece.angle) * piece.radius;
      const k = piece.type === 'line' ? 0 : Math.sign(piece.angle) / piece.radius;
      const n = Math.max(1, Math.ceil(len / step));
      const x0 = x, y0 = y, h0 = h;
      this.pieces.push({ ...piece, s0: s, s1: s + len, k });
      for (let i = 1; i <= n; i++) {
        const d = (len * i) / n;
        if (k === 0) {
          x = x0 + Math.cos(h0) * d;
          y = y0 + Math.sin(h0) * d;
          h = h0;
        } else {
          // exact arc: rotate the start point about the centre of curvature
          const r = 1 / k;
          const cx = x0 - Math.sin(h0) * r, cy = y0 + Math.cos(h0) * r;
          h = h0 + k * d;
          x = cx + Math.sin(h) * r;
          y = cy - Math.cos(h) * r;
        }
        xs.push(x); ys.push(y); hs.push(h); ss.push(s + d); ks.push(k);
      }
      s += len;
    }
    this.xs = Float64Array.from(xs);
    this.ys = Float64Array.from(ys);
    this.hs = Float64Array.from(hs);
    this.ss = Float64Array.from(ss);
    this.ks = Float64Array.from(ks);        // curvature of segment i → i+1
    this.length = s;
    this.segs = this.xs.length - 1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      minX = Math.min(minX, this.xs[i]); maxX = Math.max(maxX, this.xs[i]);
      minY = Math.min(minY, this.ys[i]); maxY = Math.max(maxY, this.ys[i]);
    }
    this.bounds = { minX, maxX, minY, maxY };
  }

  segAt(s) {
    const ss = this.ss;
    if (s <= 0) return 0;
    if (s >= this.length) return this.segs - 1;
    let lo = 0, hi = this.segs;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Position, tangent, left normal and curvature at arc length s.
  pointAt(s, out = {}) {
    const i = this.segAt(s);
    const s0 = this.ss[i], s1 = this.ss[i + 1];
    const f = clamp((s - s0) / (s1 - s0 || 1), 0, 1);
    const h = this.hs[i] + (this.hs[i + 1] - this.hs[i]) * f;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * f;
    out.y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * f;
    out.h = h;
    out.tx = Math.cos(h); out.ty = Math.sin(h);
    out.nx = -out.ty; out.ny = out.tx;
    out.k = this.ks[i];
    return out;
  }

  // Nearest point on the polyline. dist is signed: + on the normal side.
  // inside=false when the nearest point is an open end of the track.
  project(px, py, out = {}) {
    const { xs, ys } = this;
    let best = Infinity, bestD = Infinity, bi = 0, bf = 0;
    for (let i = 0; i < this.segs; i++) {
      const ax = xs[i], ay = ys[i];
      const dx = xs[i + 1] - ax, dy = ys[i + 1] - ay;
      const qx = px - ax, qy = py - ay;
      // cheap reject: segments are at most 0.25 m long, so a start point
      // further than best + 0.3 cannot belong to a nearer segment
      const r = bestD + 0.3;
      if (qx * qx + qy * qy > r * r) continue;
      const l2 = dx * dx + dy * dy;
      let f = (qx * dx + qy * dy) / l2;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const ex = qx - dx * f, ey = qy - dy * f;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; bestD = Math.sqrt(d2); bi = i; bf = (qx * dx + qy * dy) / l2; }
    }
    const fc = clamp(bf, 0, 1);
    const s = this.ss[bi] + (this.ss[bi + 1] - this.ss[bi]) * fc;
    this.pointAt(s, out);
    out.s = s;
    out.dist = (px - out.x) * out.nx + (py - out.y) * out.ny;
    out.inside = !((bi === 0 && bf < 0) || (bi === this.segs - 1 && bf > 1));
    return out;
  }
}

// ─── Levels ─────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

export function makeLevel(id) {
  if (id === 'jump') return makeJumpLevel();
  return makeJRampLevel();
}

// J-ramp: a long runway into a quarter pipe, a vertical wall and a hook that
// leaves the car upside down on a short ceiling. Suction holds it there.
export function makeJRampLevel() {
  const R1 = 12, H = 16, R2 = 7, TOP = 10;
  const main = new Track({
    name: 'jramp',
    start: [-400, 0],
    pieces: [
      { type: 'line', len: 400 },
      { type: 'arc', radius: R1, angle: 90 * DEG },
      { type: 'line', len: H },
      { type: 'arc', radius: R2, angle: 90 * DEG },
      { type: 'line', len: TOP },
    ],
  });
  const rampS0 = 400 - 4;          // where the grey ramp surface starts
  const ceilingS0 = 400 + R1 * Math.PI / 2 + H + R2 * Math.PI / 2;
  return {
    id: 'jramp',
    title: 'J-Ramp',
    tracks: [main],
    main,
    startS: 400 - 110,
    suction: true,
    obstacles: [],
    rampS0,
    ceilingS0,
    dims: { R1, H, R2, TOP, topY: R1 + H + R2 },
    focus: { minX: -16, maxX: R1 + 8, minY: -1, maxY: R1 + H + R2 + 4 },
    focusFrom: -95,
    groundY: 0,
  };
}

// Car jump: a kicker, five parked cars and a landing ramp.
export function makeJumpLevel() {
  const KR = 14, KA = 26 * DEG;
  const main = new Track({
    name: 'kicker',
    start: [-300, 0],
    pieces: [
      { type: 'line', len: 300 },
      { type: 'arc', radius: KR, angle: KA },
      { type: 'line', len: 3 },
    ],
  });
  const ground = new Track({
    name: 'ground', start: [main.bounds.maxX - 0.05, 0], visible: false,
    pieces: [{ type: 'line', len: 500 }],
  });
  const LA = -14 * DEG;
  const landStart = [44, 2.3];
  const landing = new Track({
    name: 'landing', start: landStart, heading: LA,
    pieces: [{ type: 'line', len: 2.3 / Math.sin(-LA) }],
  });
  const obstacles = [];
  for (let i = 0; i < 5; i++) obstacles.push({ x: 14 + i * 5.4, y: 0, w: 4.6, h: 1.45, i });
  const lip = main.pointAt(main.length);
  return {
    id: 'jump',
    title: 'Car Jump',
    tracks: [main, ground, landing],
    main,
    startS: 300 - 150,
    suction: false,
    obstacles,
    rampS0: 300 - 2,
    lipX: lip.x,
    lipY: lip.y,
    landingAngle: LA,
    targetSpeed: [19.8, 21.4],    // m/s approach window that lands on the ramp
    focus: { minX: -6, maxX: 60, minY: -1, maxY: 12 },
    focusFrom: -70,
    groundY: 0,
  };
}

// ─── Simulation ─────────────────────────────────────────────────────────────

export const EMPTY_INPUT = Object.freeze({
  throttle: false, brake: false, left: false, right: false,
  thrust: false, boost: false, release: false,
});

export class Sim {
  constructor(level, params = DEFAULT_PARAMS) {
    this.level = level;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.reset();
  }

  setParams(p) {
    this.params = { ...this.params, ...p };
  }

  reset() {
    const L = this.level;
    this.mode = 'track';        // track | air | crash | done
    this.surf = L.main;
    this.s = L.startS;
    this.v = 0;
    this.suction = L.suction;
    this.fuel = this.params.fuel;
    this.landed = false;
    this.grade = null;
    this.t = 0;
    this.airTime = 0;
    this.rot = 0;
    this.maxAlt = 0;
    this.topSpeed = 0;
    this.settleT = 0;
    this.crashT = 0;
    this.launch = null;
    this.landX = null;
    this.cleared = new Set();
    this.grace = 0;
    this.leftSurf = null;
    this._ap = null;
    this.result = null;
    this.events = [];
    this.jets = { lift: 0, boost: 0, noseUp: 0, noseDown: 0 };
    this.impact = 0;
    this._p = {};
    this._q = {};
    this.syncFromTrack();
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.t, ...data });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  get altitude() { return this.y - CAR.comY - this.level.groundY; }

  syncFromTrack() {
    const p = this.surf.pointAt(this.s, this._p);
    this.th = p.h;
    this.x = p.x + p.nx * CAR.comY;
    this.y = p.y + p.ny * CAR.comY;
    this.vx = p.tx * this.v;
    this.vy = p.ty * this.v;
    this.w = this.v * p.k;
    return p;
  }

  step(dt, input = EMPTY_INPUT) {
    this.t += dt;
    this.jets.lift = this.jets.boost = this.jets.noseUp = this.jets.noseDown = 0;
    if (this.mode === 'track') this.stepTrack(dt, input);
    else if (this.mode === 'air') this.stepAir(dt, input);
    else if (this.mode === 'crash') this.stepCrash(dt);
    if (this.mode !== 'done') this.checkObstacles();
    this.topSpeed = Math.max(this.topSpeed, this.speed);
  }

  useFuel(rate, dt) {
    if (this.fuel <= 0) return false;
    this.fuel = Math.max(0, this.fuel - rate * dt);
    return true;
  }

  stepTrack(dt, inp) {
    const P = this.params, g = P.gravity;
    let p = this.surf.pointAt(this.s, this._p);
    let a = -g * p.ty;
    const v = this.v;
    if (this.landed) {
      // run is over: roll out under automatic braking
      if (Math.abs(v) > 0.05) a -= Math.sign(v) * 9;
      else this.v = 0;
    } else {
      if (inp.throttle) a += Math.min(MOTOR_ACCEL * P.motor, (MOTOR_POWER * P.motor) / Math.max(Math.abs(v), 1));
      if (inp.brake) {
        if (v > 0.3) a -= BRAKE;
        else if (v > -6) a -= REVERSE;
      }
      if (inp.boost && this.useFuel(FUEL_BOOST, dt)) { a += BOOST * P.thrust; this.jets.boost = 1; }
      a -= Math.sign(v) * ROLL + DRAG * v * Math.abs(v);
    }
    this.v += a * dt;
    if (this.landed && Math.sign(this.v) !== Math.sign(v) && v !== 0) this.v = 0;
    this.s += this.v * dt;

    if (this.s <= 0 && this.surf === this.level.main) { this.s = 0; this.v = Math.max(0, this.v); }
    if (this.s >= this.surf.length || (this.s <= 0 && this.v < 0 && this.surf !== this.level.main)) {
      this.s = clamp(this.s, 0, this.surf.length);
      this.syncFromTrack();
      if (!this.handoff()) this.goAirborne('lip');
      return;
    }
    p = this.syncFromTrack();

    // Normal force per unit mass. The surface can only push (N ≥ 0) unless
    // suction is engaged, which lets it pull up to `suction × g`.
    const N = this.v * this.v * p.k + g * p.ny;
    const grip = this.suction ? P.suction * g : 0;
    if (N < -grip - 1e-6) { this.goAirborne(this.suction ? 'overpowered' : 'liftoff'); return; }

    if (inp.release && !this.landed && this.suction && p.ny < 0.7) {
      this.suction = false;
      this.goAirborne('release', 0.6);
      return;
    }

    if (this.landed) {
      this.settleT += dt;
      if (this.settleT > 2.2 || (this.settleT > 0.7 && Math.abs(this.v) < 0.4)) this.finish();
    }
  }

  // Roll from the end of one surface onto another that touches it.
  handoff() {
    const bx = this.x + Math.sin(this.th) * CAR.comY, by = this.y - Math.cos(this.th) * CAR.comY;
    const tx = Math.cos(this.th), ty = Math.sin(this.th);
    for (const tr of this.level.tracks) {
      if (tr === this.surf) continue;
      const q = tr.project(bx + tx * Math.sign(this.v) * 0.3, by + ty * Math.sign(this.v) * 0.3, {});
      if (!q.inside || Math.abs(q.dist) > 0.4) continue;
      this.v *= tx * q.tx + ty * q.ty;
      this.surf = tr;
      this.s = q.s;
      this.syncFromTrack();
      return true;
    }
    return false;
  }

  goAirborne(reason, push = 0) {
    const p = this.surf.pointAt(this.s, this._p);
    // the car's corners overhang a curved surface it just left; ignore that
    // surface for a moment so the overhang is not read as a touchdown
    this.leftSurf = this.surf;
    this.grace = 0.3;
    this.mode = 'air';
    this.suction = false;
    this.vx += p.nx * push;
    this.vy += p.ny * push;
    this.launch = { x: this.x, y: this.y, t: this.t, speed: this.speed, reason };
    this.emit('airborne', { reason, speed: this.speed });
  }

  stepAir(dt, inp) {
    const P = this.params, g = P.gravity;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    let ax = 0, ay = -g, aw = 0;
    if (inp.thrust && this.useFuel(FUEL_LIFT, dt)) {
      const T = LIFT_G * g * P.thrust;
      ax += -s * T; ay += c * T;
      this.jets.lift = 1;
    }
    if (inp.boost && this.useFuel(FUEL_BOOST, dt)) {
      ax += c * BOOST * P.thrust; ay += s * BOOST * P.thrust;
      this.jets.boost = 1;
    }
    const turn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    if (turn && this.useFuel(FUEL_PITCH, dt)) {
      aw += turn * ALPHA * P.thrust;
      if (turn > 0) this.jets.noseUp = 1; else this.jets.noseDown = 1;
    }
    this.w += aw * dt;
    this.w *= 1 - 0.12 * dt;
    const sp = Math.hypot(this.vx, this.vy);
    this.vx += (ax - this.vx * sp * AIR_DRAG) * dt;
    this.vy += (ay - this.vy * sp * AIR_DRAG) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.th += this.w * dt;
    if (!this.landed) {
      this.rot += this.w * dt;
      this.airTime += dt;
      this.maxAlt = Math.max(this.maxAlt, this.altitude);
    }
    if (this.grace > 0) this.grace -= dt;

    this.countCleared();

    const hit = this.findContact();
    if (hit) this.resolveLanding(hit);
    else if (this.y < -60 || Math.abs(this.x) > 700 || this.airTime > 40) this.crash('lost');
  }

  countCleared() {
    for (const o of this.level.obstacles) {
      if (!this.cleared.has(o.i) && this.x - CAR.halfLen > o.x + o.w) {
        this.cleared.add(o.i);
        this.emit('clear', { index: o.i, count: this.cleared.size });
      }
    }
  }

  // Deepest corner that is below a surface and moving into it.
  findContact() {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    let best = null;
    for (let ci = 0; ci < 4; ci++) {
      const [lx, ly] = CAR.corners[ci];
      const rx = c * lx - s * ly, ry = s * lx + c * ly;
      const px = this.x + rx, py = this.y + ry;
      for (const tr of this.level.tracks) {
        if (this.grace > 0 && tr === this.leftSurf) continue;
        const b = tr.bounds;
        if (px < b.minX - 2 || px > b.maxX + 2 || py < b.minY - 2 || py > b.maxY + 2) continue;
        const q = tr.project(px, py, {});
        if (!q.inside || q.dist >= 0 || q.dist < -1.6) continue;
        const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
        const vn = vpx * q.nx + vpy * q.ny;
        if (vn >= 0) continue;
        if (!best || q.dist < best.q.dist) best = { q, tr, ci, rx, ry, vn };
      }
    }
    return best;
  }

  resolveLanding(hit) {
    const { q, tr, ci } = hit;
    // angle between the car's up axis and the surface normal
    const ux = -Math.sin(this.th), uy = Math.cos(this.th);
    const ang = Math.atan2(q.nx * uy - q.ny * ux, q.nx * ux + q.ny * uy);
    const vn = this.vx * q.nx + this.vy * q.ny;
    const wheels = ci <= 1;
    this.impact = -vn;
    if (!wheels || Math.abs(ang) > LAND_MAX_ANGLE || -vn > LAND_MAX_VN || Math.abs(this.w) > LAND_MAX_SPIN) {
      this.crash(!wheels ? 'roof' : Math.abs(ang) > LAND_MAX_ANGLE ? 'angle' : -vn > LAND_MAX_VN ? 'hard' : 'spin');
      return;
    }
    const absA = Math.abs(ang), ivn = -vn;
    // snap the wheel line onto the surface, keeping the tangential speed
    const bq = tr.project(this.x + Math.sin(this.th) * CAR.comY, this.y - Math.cos(this.th) * CAR.comY, {});
    this.surf = tr;
    // off the start of the surface: slide back from the touching corner
    this.s = bq.inside ? bq.s : clamp(q.s - CAR.corners[ci][0] * Math.sign(this.vx * q.tx + this.vy * q.ty || 1), 0, tr.length);
    this.v = this.vx * q.tx + this.vy * q.ty;
    this.mode = 'track';
    if (!this.landed) {
      this.grade = absA < 0.13 && ivn < 5.5 ? 'perfect' : absA < 0.32 && ivn < 9 ? 'clean' : 'rough';
      this.landed = true;
      this.landX = this.x;
      this.emit('land', { grade: this.grade, impact: ivn, angle: ang, surface: tr.name });
    }
    this.syncFromTrack();
    this.countCleared();
  }

  crash(reason) {
    if (this.mode === 'crash' || this.mode === 'done') return;
    this.mode = 'crash';
    this.crashReason = reason;
    this.crashT = 0;
    this.grade = 'crash';
    this.emit('crash', { reason, impact: this.impact, speed: this.speed });
    // keep current motion; add a tumble from the hit
    this.w += (Math.random() - 0.5) * 3 + (this.vx > 0 ? -2 : 2);
  }

  // Free rigid body with impulse contacts, used once the car has crashed.
  stepCrash(dt) {
    const g = this.params.gravity;
    this.crashT += dt;
    this.vy -= g * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.th += this.w * dt;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    for (let ci = 0; ci < 4; ci++) {
      const [lx, ly] = CAR.corners[ci];
      const rx = c * lx - s * ly, ry = s * lx + c * ly;
      for (const tr of this.level.tracks) {
        const q = tr.project(this.x + rx, this.y + ry, this._q);
        if (!q.inside || q.dist >= 0 || q.dist < -2) continue;
        // push out
        this.x -= q.nx * q.dist; this.y -= q.ny * q.dist;
        const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
        const vn = vpx * q.nx + vpy * q.ny;
        if (vn >= 0) continue;
        const rn = rx * q.ny - ry * q.nx;
        const j = (-(1 + 0.28) * vn) / (1 + (rn * rn) / CAR.inertia);
        const vt = vpx * q.tx + vpy * q.ty;
        const rt = rx * q.ty - ry * q.tx;
        let jt = -vt / (1 + (rt * rt) / CAR.inertia);
        jt = clamp(jt, -0.55 * j, 0.55 * j);
        this.vx += q.nx * j + q.tx * jt;
        this.vy += q.ny * j + q.ty * jt;
        this.w += (rn * j + rt * jt) / CAR.inertia;
        if (j > 2.5) this.emit('impact', { x: this.x + rx, y: this.y + ry, strength: j });
      }
    }
    this.w *= 1 - 0.4 * dt;
    const still = this.speed < 0.6 && Math.abs(this.w) < 0.6;
    if (this.crashT > 3.2 || (this.crashT > 1.2 && still) || this.y < -60) this.finish();
  }

  checkObstacles() {
    const obs = this.level.obstacles;
    if (!obs.length) return;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    for (const o of obs) {
      if (obbOverlapsBox(this.x, this.y, c, s, o)) {
        if (this.mode !== 'crash') {
          this.impact = this.speed;
          this.crash('car');
        }
        // crude separation so the wreck rides over the parked car
        const top = o.y + o.h + 0.6;
        if (this.y < top) { this.y += (top - this.y) * 0.25; this.vy = Math.max(this.vy, 0); }
      }
    }
  }

  finish() {
    if (this.mode === 'done') return;
    const L = this.level;
    const crashed = this.grade === 'crash';
    const items = [];
    let success = !crashed;
    if (L.id === 'jramp') {
      const deg = Math.abs(this.rot) / DEG;
      if (!crashed) {
        items.push(['Rotation', `${Math.round(deg)}°`, Math.round(deg * 4)]);
        items.push(['Air time', `${this.airTime.toFixed(2)} s`, Math.round(this.airTime * 250)]);
        items.push(['Landing', this.grade, { perfect: 2500, clean: 1200, rough: 300 }[this.grade]]);
        items.push(['Gas left', `${Math.round(this.fuel)}%`, Math.round(this.fuel * 8)]);
      }
    } else {
      const cars = this.cleared.size;
      const dist = this.landX != null && this.launch ? Math.max(0, this.landX - L.lipX) : 0;
      success = !crashed && cars === L.obstacles.length;
      if (!crashed) {
        items.push(['Distance', `${dist.toFixed(1)} m`, Math.round(dist * 40)]);
        items.push(['Cars cleared', `${cars}/${L.obstacles.length}`, cars * 300]);
        items.push(['Landing', this.grade, { perfect: 2500, clean: 1200, rough: 300 }[this.grade]]);
        items.push(['Gas left', `${Math.round(this.fuel)}%`, Math.round(this.fuel * 8)]);
      }
    }
    const score = items.reduce((t, it) => t + it[2], 0);
    this.result = {
      level: L.id, success, crashed, reason: this.crashReason || null,
      grade: this.grade, score, items,
      flips: Math.abs(this.rot) / TAU, airTime: this.airTime,
      cleared: this.cleared.size, topSpeed: this.topSpeed, maxAlt: this.maxAlt,
    };
    this.mode = 'done';
    this.emit('done', { result: this.result });
  }
}

// Separating-axis test between the car's oriented box and an axis-aligned box.
function obbOverlapsBox(cx, cy, c, s, o) {
  const hx = CAR.halfLen, hy = 0.55;
  const ox = o.x + o.w / 2, oy = o.y + o.h / 2, ex = o.w / 2, ey = o.h / 2;
  const dx = ox - cx, dy = oy - cy;
  // axes: world x, world y, car forward, car up
  const ax = [[1, 0], [0, 1], [c, s], [-s, c]];
  for (const [ux, uy] of ax) {
    const rCar = hx * Math.abs(c * ux + s * uy) + hy * Math.abs(-s * ux + c * uy);
    const rBox = ex * Math.abs(ux) + ey * Math.abs(uy);
    if (Math.abs(dx * ux + dy * uy) > rCar + rBox) return false;
  }
  return true;
}

// ─── Autopilot ──────────────────────────────────────────────────────────────

// A small controller that can fly both levels. Drives the title-screen demo
// and the end-to-end tests.
export function autopilot(sim, opts = {}) {
  const L = sim.level, P = sim.params, g = P.gravity;
  const inp = { ...EMPTY_INPUT };
  if (sim.mode === 'track' && !sim.landed) {
    if (L.id === 'jramp') {
      inp.throttle = true;
      const releaseAt = L.ceilingS0 + (opts.releaseAfter ?? 3);
      if (sim.surf === L.main && sim.s > releaseAt) inp.release = true;
    } else {
      const target = opts.targetSpeed ?? (L.targetSpeed[0] + L.targetSpeed[1]) / 2;
      if (sim.v < target - 0.4) inp.throttle = true;
      else if (sim.v > target + 0.6) inp.brake = true;
    }
    return inp;
  }
  if (sim.mode !== 'air') { if (sim.mode !== 'track') sim._ap = null; return inp; }

  // Attitude: pick a wheels-down heading for the surface below once, at
  // take-off, optionally adding extra full turns.
  const want = L.id === 'jump' ? L.landingAngle : 0;
  if (!sim._ap) {
    const base = want + Math.round((sim.th - want) / TAU) * TAU;
    const dir = base >= sim.th ? 1 : -1;
    sim._ap = { target: base + dir * (opts.spin ?? 0) * TAU };
  }
  const target = sim._ap.target;
  const err = target - sim.th;
  const fall = Math.max(0, -sim.vy);
  const alt = sim.altitude;
  const tLeft = fall > 0.1 ? (Math.sqrt(sim.vy * sim.vy + 2 * g * Math.max(alt, 0)) + sim.vy) / g : 2;
  // finish rotating ~0.6 s before touchdown so the lift jets can work
  const wantW = clamp(err / Math.max(tLeft - 0.6, 0.3), -5.5, 5.5);
  if (sim.w < wantW - 0.25) inp.left = true;
  else if (sim.w > wantW + 0.25) inp.right = true;

  // Lift: brake the descent late, only once roughly upright.
  const TL = LIFT_G * g * P.thrust;
  const upright = Math.cos(sim.th - want) > 0.85;
  const stop = (fall * fall - 16) / (2 * (TL - g));
  if (upright && fall > 4.5 && alt < stop * 1.25 + 1.5) inp.thrust = true;
  return inp;
}

export { obbOverlapsBox as _obbOverlapsBox };
