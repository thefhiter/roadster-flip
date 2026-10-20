// Procedural Roadster, modelled after the second-generation Tesla Roadster:
// a low blunt nose with no grille, slim slanted headlights, front fenders that
// rise above a dipped bonnet, a teardrop all-glass canopy with a steeply raked
// windscreen, a pinched waist with a deep side scoop, wide rear haunches, a
// Kamm tail with a ducktail lip, slim wraparound tail lights and big
// turbine-style wheels on low-profile tyres.
//
// The body is lofted from cross-sections whose shape is driven by smooth
// curves along the car's length; details are decals conformed to the body by
// ray casting, so they follow its curvature.
//
// Local frame: +x forward, +y up, +z towards the camera. Origin = wheel
// contact line, so the physics centre of mass is at y = 0.5.
import * as THREE from 'three';

const WHEEL_R = 0.36;
export const WHEELS = [
  { x: 1.36, z: 0.83, width: 0.27 },
  { x: -1.36, z: 0.85, width: 0.31 },
];
const ARCH = { r: 0.52, y: 0.26 };   // arch circle, centre below the axle line
const NOSE = 2.24, TAIL = -2.22;

// Smooth scalar curve through [x, value] keys (cubic Hermite, finite-difference
// tangents), clamped at the ends.
function curve(keys) {
  keys = [...keys].sort((a, b) => a[0] - b[0]);
  const n = keys.length;
  const slope = (j) => {
    const a = keys[Math.max(0, j - 1)], b = keys[Math.min(n - 1, j + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (x > keys[i + 1][0]) i++;
    const [x0, v0] = keys[i], [x1, v1] = keys[i + 1];
    const h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * slope(i) * h
      + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * slope(i + 1) * h;
  };
}

// Body proportions along x (front at +x).
const halfW = curve([[NOSE, 0.5], [2.19, 0.7], [2.06, 0.85], [1.8, 0.94], [1.36, 0.98], [0.9, 0.95],
  [0.3, 0.9], [-0.35, 0.92], [-0.95, 0.99], [-1.36, 1.01], [-1.8, 0.98], [-2.08, 0.92], [TAIL, 0.84]]);
const yTop = curve([[NOSE, 0.43], [2.16, 0.55], [1.95, 0.62], [1.5, 0.71], [1.0, 0.8], [0.8, 0.84],
  [0.3, 0.86], [-0.5, 0.88], [-1.0, 0.95], [-1.5, 0.98], [-1.9, 0.95], [-2.12, 0.92], [TAIL, 0.86]]);
const yShoulder = curve([[NOSE, 0.45], [2.12, 0.6], [1.85, 0.76], [1.4, 0.87], [0.95, 0.85], [0.35, 0.8],
  [-0.35, 0.83], [-0.9, 0.92], [-1.36, 0.99], [-1.8, 0.97], [-2.1, 0.93], [TAIL, 0.88]]);
const yBelt = curve([[NOSE, 0.4], [2.0, 0.48], [1.4, 0.55], [0.4, 0.5], [-0.6, 0.55], [-1.4, 0.62], [TAIL, 0.62]]);
const yFloor = curve([[NOSE, 0.36], [2.14, 0.24], [1.95, 0.2], [-2.0, 0.2], [-2.12, 0.27], [TAIL, 0.32]]);

function archLow(x) {
  let y = -Infinity;
  for (const w of WHEELS) {
    const d = x - w.x;
    if (Math.abs(d) < ARCH.r) y = Math.max(y, ARCH.y + Math.sqrt(ARCH.r * ARCH.r - d * d));
  }
  return y;
}

// Closed cross-section at station x, as control points in the (z, y) plane.
function sectionControls(x) {
  const hw = halfW(x), top = yTop(x), sh = Math.max(yShoulder(x), top - 0.02), fl = yFloor(x);
  const arch = archLow(x);
  const rocker = Math.min(Math.max(fl + 0.03, arch), sh - 0.05);
  const belt = Math.min(Math.max(yBelt(x), arch + 0.05), sh - 0.025);
  const half = [
    [0, fl],
    [Math.min(0.58, hw * 0.62), fl],                  // chassis edge, inner wheel-well wall
    [hw * 0.9, rocker],
    [hw, belt],
    [hw * 0.8, sh],                                    // fender crown
    [hw * 0.42, top + (sh - top) * 0.3],
    [0, top],
  ];
  const pts = half.map(([z, y]) => new THREE.Vector3(x, y, z));
  for (let i = half.length - 2; i >= 1; i--) pts.push(new THREE.Vector3(x, half[i][1], -half[i][0]));
  return pts;
}

// Grid surface from rows of points; optionally capped at both ends.
function gridGeometry(rows, closed, caps) {
  const R = rows.length, C = rows[0].length;
  const pos = [];
  for (const row of rows) for (const p of row) pos.push(p.x, p.y, p.z);
  const idx = [];
  const cols = closed ? C : C - 1;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % C;
      const a = i * C + j, b = i * C + j1, c = (i + 1) * C + j1, d = (i + 1) * C + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, false], [R - 1, true]]) {
      const row = rows[ri];
      const cen = row.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / C);
      const ci = pos.length / 3;
      pos.push(cen.x, cen.y, cen.z);
      for (let j = 0; j < C; j++) {
        const a = ri * C + j, b = ri * C + ((j + 1) % C);
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Make sure the normals point out of the solid (+y at the highest vertex).
function orientOutward(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  let top = 0;
  for (let i = 1; i < p.count; i++) if (p.getY(i) > p.getY(top)) top = i;
  if (n.getY(top) < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

function bodyGeometry() {
  const STATIONS = 140, AROUND = 64;
  const rows = [];
  for (let i = 0; i <= STATIONS; i++) {
    // ease the station spacing so the rounded nose and tail get more rows
    const u = i / STATIONS;
    const x = TAIL + (NOSE - TAIL) * (0.5 - 0.5 * Math.cos(Math.PI * u)) * 0.06 + (NOSE - TAIL) * u * 0.94;
    const c = new THREE.CatmullRomCurve3(sectionControls(x), true, 'centripetal');
    rows.push(c.getPoints(AROUND).slice(0, AROUND));
  }
  return orientOutward(gridGeometry(rows, true, true));
}

function canopyGeometry() {
  const base = curve([[0.9, 0.79], [0.4, 0.75], [-0.4, 0.78], [-1.15, 0.9]]);
  const top = curve([[0.9, 0.8], [0.62, 0.95], [0.3, 1.06], [0.0, 1.13], [-0.28, 1.15], [-0.58, 1.12],
    [-0.88, 1.05], [-1.15, 0.92]]);
  const hw = curve([[0.9, 0.42], [0.6, 0.62], [0.1, 0.7], [-0.5, 0.66], [-0.9, 0.55], [-1.15, 0.32]]);
  const rows = [];
  const N = 70;
  for (let i = 0; i <= N; i++) {
    const x = 0.9 - (2.05 * i) / N;
    const b = base(x), h = Math.max(0.005, top(x) - b), w = hw(x);
    const half = [[w, b], [w * 0.86, b + h * 0.5], [w * 0.62, b + h * 0.86], [w * 0.3, b + h * 0.99], [0, b + h]];
    const pts = half.map(([z, y]) => new THREE.Vector3(x, y, z));
    for (let k = half.length - 2; k >= 0; k--) pts.push(new THREE.Vector3(x, half[k][1], -half[k][0]));
    rows.push(new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(36));
  }
  return orientOutward(gridGeometry(rows, false, false));
}

// A strip decal along a polyline of approximate surface points, projected onto
// the body along `dir` and lifted off it a hair. `width` may be a function of
// the strip parameter t ∈ [0, 1].
const raycaster = new THREE.Raycaster();
function decal(target, path, width, dir, material, samples = 40, lift = 0.006) {
  const c = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const d = new THREE.Vector3(...dir).normalize();
  const pos = [];
  const wf = typeof width === 'function' ? width : () => width;
  const hit = (p) => {
    raycaster.set(p.clone().addScaledVector(d, -1.5), d);
    const h = raycaster.intersectObject(target, false)[0];
    if (!h) return p.clone();
    return h.point.clone().addScaledVector(h.face.normal, lift);
  };
  // several rows across the width, each conformed, so the strip hugs the curve
  const A = 4;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = c.getPoint(t), tan = c.getTangent(t);
    const side = new THREE.Vector3().crossVectors(tan, d).normalize().multiplyScalar(wf(t) / 2);
    for (let k = 0; k <= A; k++) {
      const q = hit(p.clone().addScaledVector(side, 1 - (2 * k) / A));
      pos.push(q.x, q.y, q.z);
    }
  }
  const idx = [];
  for (let i = 0; i < samples; i++) {
    for (let k = 0; k < A; k++) {
      const a = i * (A + 1) + k, b = a + 1, c2 = a + A + 2, d2 = a + A + 1;
      idx.push(a, b, c2, a, c2, d2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 1;
  return m;
}

function flameGeometry() {
  // open cone, base at the origin, apex 1 unit along -y
  const g = new THREE.ConeGeometry(0.17, 1, 14, 1, true);
  g.rotateX(Math.PI);
  g.translate(0, -0.5, 0);
  return g;
}

export const PAINTS = Object.freeze({
  white: { label: 'Pearl White', color: 0xe4e4e0, metalness: 0.05, roughness: 0.46 },
  red: { label: 'Multi-Coat Red', color: 0x8e0b10, metalness: 0.45, roughness: 0.3 },
  black: { label: 'Solid Black', color: 0x0d0e10, metalness: 0.3, roughness: 0.28 },
  silver: { label: 'Midnight Silver', color: 0x5a5e64, metalness: 0.75, roughness: 0.32 },
});

export function applyPaint(material, name) {
  const p = PAINTS[name] || PAINTS.white;
  material.color.setHex(p.color);
  material.metalness = p.metalness;
  material.roughness = p.roughness;
}

function wheel(side, width, mats) {
  const w = new THREE.Group();
  // tyre: lathe profile with rounded shoulders, axis along z
  const pr = [];
  const hw = width / 2;
  pr.push(new THREE.Vector2(0.29, -hw));
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * Math.PI / 2;
    pr.push(new THREE.Vector2(WHEEL_R - 0.04 + Math.cos(a) * 0.04, -hw + 0.04 + Math.sin(a) * 0.04));
  }
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI / 2;
    pr.push(new THREE.Vector2(WHEEL_R - 0.04 + Math.cos(a) * 0.04, hw - 0.04 + Math.sin(a) * 0.04));
  }
  pr.push(new THREE.Vector2(0.29, hw));
  const tyreGeo = new THREE.LatheGeometry(pr, 40);
  tyreGeo.rotateX(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, mats.tyre);
  tyre.castShadow = true;
  w.add(tyre);
  // rim barrel + recessed face
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, width - 0.02, 40, 1, true), mats.rimDark);
  barrel.rotation.x = Math.PI / 2;
  w.add(barrel);
  const faceZ = side * (hw - 0.025);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.288, 40), mats.rimDark);
  face.position.z = faceZ - side * 0.012;
  if (side < 0) face.rotation.y = Math.PI;
  w.add(face);
  // turbine spokes: twelve thin twisted blades
  const blade = new THREE.BoxGeometry(0.2, 0.026, 0.014);
  blade.translate(0.17, 0, 0);
  for (let k = 0; k < 12; k++) {
    const b = new THREE.Mesh(blade, mats.rim);
    b.rotation.z = (k / 12) * Math.PI * 2;
    b.rotation.x = side * 0.5;
    b.position.z = faceZ;
    w.add(b);
  }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.008, 6, 48), mats.rim);
  lip.position.z = faceZ;
  w.add(lip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 24), mats.rim);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = faceZ;
  w.add(cap);
  return w;
}

export function buildRoadster(envMap, paintName = 'white') {
  const root = new THREE.Group();     // placed at the physics centre of mass
  const body = new THREE.Group();     // suspension / landing wobble lives here
  body.position.y = -0.5;
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.7, clearcoatRoughness: 0.32, specularIntensity: 0.45, envMap, envMapIntensity: 0.24,
    emissive: 0xffffff, emissiveIntensity: 0.004,
  });
  applyPaint(paint, paintName);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x020305, metalness: 0.25, roughness: 0.14, clearcoat: 0.6, clearcoatRoughness: 0.25, specularIntensity: 0.5, envMap, envMapIntensity: 0.16,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.45, metalness: 0.3, envMap, envMapIntensity: 0.3 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.85 });
  const decalOpts = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const trimDecal = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.35, metalness: 0.4, envMap, envMapIntensity: 0.3, ...decalOpts });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.4, 3.6), ...decalOpts });
  const drlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.25, 1.35), ...decalOpts });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.1, 0.05), ...decalOpts });
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, ...decalOpts });

  const shell = new THREE.Mesh(bodyGeometry(), paint);
  shell.castShadow = true;
  // decals are ray-cast against the shell in its own frame, so it joins the
  // group only after they are built
  shell.updateMatrixWorld();

  const canopy = new THREE.Mesh(canopyGeometry(), glass);
  canopy.castShadow = true;
  body.add(canopy);

  // chassis tub and wheel-well liners hide the arch openings from every angle
  const tub = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.36, 1.16), satin);
  tub.position.set(0, 0.4, 0);
  body.add(tub);
  for (const w of WHEELS) for (const s of [-1, 1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(ARCH.r - 0.02, ARCH.r - 0.02, 0.42, 28, 1, true, Math.PI / 2, Math.PI), satin);
    liner.material = satin.clone();
    liner.material.side = THREE.BackSide;
    liner.rotation.x = Math.PI / 2;
    liner.position.set(w.x, ARCH.y, s * 0.74);
    body.add(liner);
  }

  // ── decals conformed to the body ──
  for (const s of [-1, 1]) {
    const side = [0, 0, -s];
    // headlights: slim, slanted, sweeping from the nose up onto the fender
    body.add(decal(shell, [[2.17, 0.53, s * 0.36], [2.08, 0.6, s * 0.6], [1.93, 0.69, s * 0.8]],
      (t) => 0.035 + 0.035 * Math.sin(Math.PI * t), [-0.8, -0.6, 0], headMat, 24));
    // daytime-running hook under the headlight
    body.add(decal(shell, [[2.16, 0.5, s * 0.5], [2.06, 0.55, s * 0.74], [2.0, 0.57, s * 0.8]], 0.012, [-0.85, -0.5, 0], drlMat, 16));
    // tail lights: thin bars across the upper tail corners, wrapping round
    body.add(decal(shell, [[-2.2, 0.8, s * 0.22], [-2.19, 0.81, s * 0.6], [-2.12, 0.8, s * 0.86], [-1.98, 0.76, s * 0.96]],
      0.03, [1, -0.25, -s * 0.15], tailMat, 32));
    // side intake: a teardrop opening just ahead of the rear wheel, under a
    // crease that sweeps up from the door onto the rear haunch
    body.add(decal(shell, [[-0.18, 0.55, s], [-0.45, 0.53, s], [-0.7, 0.5, s], [-0.8, 0.49, s]],
      (t) => 0.03 + 0.15 * Math.sin(Math.min(1, t * 1.25) * Math.PI / 2), side, trimDecal, 30));
    body.add(decal(shell, [[0.5, 0.66, s], [-0.2, 0.67, s], [-0.75, 0.74, s], [-1.05, 0.83, s]], 0.008, side, seamMat, 30, 0.01));
    // thin dark rocker
    body.add(decal(shell, [[0.8, 0.29, s], [0, 0.28, s], [-0.8, 0.3, s]], 0.035, side, trimDecal, 24));
    // door shut lines
    body.add(decal(shell, [[0.62, 0.84, s], [0.66, 0.55, s], [0.6, 0.32, s]], 0.006, side, seamMat, 16, 0.01));
    body.add(decal(shell, [[-0.88, 0.9, s], [-0.86, 0.72, s], [-0.9, 0.6, s]], 0.006, side, seamMat, 12, 0.01));
    // mirrors on short stalks
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.14), trim);
    stalk.position.set(0.58, 0.86, s * 0.74);
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12), paint);
    pod.scale.set(1.2, 0.55, 0.7);
    pod.position.set(0.56, 0.88, s * 0.85);
    body.add(stalk, pod);
  }
  // front: wide black intake and a splitter, no grille
  body.add(decal(shell, [[2.2, 0.33, -0.62], [2.24, 0.33, 0], [2.2, 0.33, 0.62]], 0.08, [-1, 0, 0], trimDecal, 30));
  // rear: diffuser across the bottom of the tail, with fins
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 1.36), trim);
  diffuser.position.set(-2.05, 0.3, 0);
  body.add(diffuser);
  for (const z of [-0.45, -0.15, 0.15, 0.45]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.02), trim);
    fin.position.set(-2.06, 0.29, z);
    body.add(fin);
  }
  // ducktail lip: a fine dark line marks the edge of the deck
  body.add(decal(shell, [[-2.05, 0.93, -0.76], [-2.14, 0.92, 0], [-2.05, 0.93, 0.76]], 0.01, [0.3, -1, 0], seamMat, 30));

  body.add(shell);

  // wheels
  const mats = {
    tyre: new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.92 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.7, roughness: 0.45, envMap, envMapIntensity: 0.3 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xa4a7ad, metalness: 0.95, roughness: 0.22, envMap, envMapIntensity: 0.6 }),
  };
  const wheels = [];
  for (const w of WHEELS) {
    for (const s of [-1, 1]) {
      const g = wheel(s, w.width, mats);
      g.position.set(w.x, WHEEL_R, s * w.z);
      body.add(g);
      wheels.push(g);
    }
  }

  // cold-gas jets: each has a direction (exhaust) and a channel it fires on
  const flameGeo = flameGeometry();
  const jets = [];
  const addJet = (channel, pos, dir, length, width = 1) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 1.8, 2.2), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(flameGeo, mat);
    m.position.set(...pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...dir).normalize());
    m.scale.set(width, 0.001, width);
    m.visible = false;
    body.add(m);
    jets.push({ channel, mesh: m, mat, dir: new THREE.Vector3(...dir).normalize(), length, width, level: 0 });
  };
  for (const x of [-1.0, 1.0]) for (const z of [-0.45, 0.45]) addJet('lift', [x, 0.2, z], [0, -1, 0], 2.4, 1.15);
  // pitch: nose-up fires under the nose and over the tail
  addJet('noseUp', [1.98, 0.21, 0], [0, -1, 0], 1.3, 0.8);
  addJet('noseUp', [-1.95, 0.96, 0], [0, 1, 0], 1.3, 0.8);
  addJet('noseDown', [1.98, 0.63, 0], [0, 1, 0], 1.3, 0.8);
  addJet('noseDown', [-2.0, 0.22, 0], [0, -1, 0], 1.3, 0.8);
  for (const z of [-0.38, 0.38]) addJet('boost', [-2.23, 0.52, z], [-1, 0, 0], 2.6, 1.1);

  // a light under the car that washes the ground while the lift jets fire
  const jetLight = new THREE.PointLight(0xcfe0ff, 0, 18, 1.6);
  jetLight.position.set(0, -0.4, 0);
  body.add(jetLight);

  // headlight beam
  const beam = new THREE.SpotLight(0xffffff, 60, 45, 0.45, 0.6, 1.2);
  beam.position.set(2.2, 0.55, 0);
  beam.target.position.set(10, 0.2, 0);
  body.add(beam, beam.target);

  return { root, body, wheels, jets, jetLight, beam, paint, wheelRadius: WHEEL_R };
}

// Parked cars in the jump level: X-ray style — faint glass body, bright edges.
export function buildParkedCar(len = 4.6, h = 1.45) {
  const g = new THREE.Group();
  const lower = new THREE.BoxGeometry(len, h * 0.55, 1.8);
  lower.translate(0, h * 0.275 + 0.12, 0);
  const upper = new THREE.BoxGeometry(len * 0.52, h * 0.42, 1.5);
  upper.translate(-len * 0.05, h * 0.55 + 0.12 + h * 0.21, 0);
  const fill = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, transparent: true, opacity: 0.55 });
  const edge = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  for (const geo of [lower, upper]) {
    const m = new THREE.Mesh(geo, fill);
    m.castShadow = true;
    g.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge));
  }
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 18);
  wheelGeo.rotateX(Math.PI / 2);
  const wm = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  for (const x of [-len * 0.32, len * 0.32]) for (const z of [-0.85, 0.85]) {
    const w = new THREE.Mesh(wheelGeo, wm);
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  return { group: g, edge };
}
