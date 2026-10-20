// Procedural roadster: an extruded side profile for the body, a darker glass
// canopy, light strips, four wheels and a set of cold-gas jets.
// Local frame: +x forward, +y up, +z towards the camera. Origin = wheel
// contact line, so the physics centre of mass is at y = 0.5.
import * as THREE from 'three';

const WHEEL_R = 0.36;

function bodyProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.12, 0.34);
  // rear wheel arch
  s.lineTo(-1.82, 0.32);
  s.absarc(-1.36, 0.36, 0.45, Math.PI, 0, true);
  s.lineTo(0.92, 0.31);
  // front wheel arch
  s.absarc(1.36, 0.36, 0.45, Math.PI, 0, true);
  s.lineTo(2.06, 0.3);
  // nose
  s.quadraticCurveTo(2.24, 0.34, 2.23, 0.5);
  s.quadraticCurveTo(2.2, 0.66, 1.9, 0.72);
  // long low bonnet up to the windscreen base
  s.quadraticCurveTo(1.25, 0.86, 0.62, 0.94);
  // beltline back to the tail
  s.quadraticCurveTo(-0.5, 1.02, -1.45, 1.0);
  s.quadraticCurveTo(-2.0, 0.96, -2.18, 0.84);
  s.quadraticCurveTo(-2.24, 0.6, -2.12, 0.34);
  return s;
}

function canopyProfile() {
  const s = new THREE.Shape();
  s.moveTo(0.78, 0.9);
  s.quadraticCurveTo(0.25, 1.18, -0.2, 1.26);
  s.quadraticCurveTo(-0.65, 1.3, -0.95, 1.24);
  s.quadraticCurveTo(-1.45, 1.12, -1.8, 0.96);
  s.lineTo(0.78, 0.9);
  return s;
}

function extrude(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 18,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 5,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

function flameGeometry() {
  // open cone, base at the origin, apex 1 unit along -y
  const g = new THREE.ConeGeometry(0.17, 1, 14, 1, true);
  g.rotateX(Math.PI);
  g.translate(0, -0.5, 0);
  return g;
}

export function buildRoadster(envMap) {
  const root = new THREE.Group();     // placed at the physics centre of mass
  const body = new THREE.Group();     // suspension / landing wobble lives here
  body.position.y = -0.5;
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xd9d9d5, metalness: 0.05, roughness: 0.38,
    clearcoat: 1, clearcoatRoughness: 0.12, envMap, envMapIntensity: 0.22,
    emissive: 0xffffff, emissiveIntensity: 0.006,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x020304, metalness: 0.2, roughness: 0.05,
    clearcoat: 1, envMap, envMapIntensity: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.8 });

  const shell = new THREE.Mesh(extrude(bodyProfile(), 1.66, 0.16), paint);
  shell.castShadow = true;
  body.add(shell);

  const canopy = new THREE.Mesh(extrude(canopyProfile(), 1.24, 0.12), glass);
  canopy.castShadow = true;
  body.add(canopy);

  // floor pan closes the wheel arches seen from below during flips
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.08, 1.7), dark);
  floor.position.set(0, 0.34, 0);
  body.add(floor);

  // black trim: sills between the arches, front intake, rear diffuser, mirrors
  const trim = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.5, metalness: 0.2 });
  for (const z of [-0.93, 0.93]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 0.06), trim);
    sill.position.set(0, 0.4, z);
    body.add(sill);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.16), paint);
    mirror.position.set(0.55, 1.0, z * 0.98);
    body.add(mirror);
  }
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.2), trim);
  intake.position.set(2.2, 0.4, 0);
  body.add(intake);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.5), trim);
  diffuser.position.set(-2.2, 0.42, 0);
  body.add(diffuser);

  // light strips: thin bright bars so the bloom picks them up
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.2, 3.4) });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.12, 0.06) });
  for (const z of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.36), head);
    h.position.set(2.27, 0.62, z);
    h.rotation.z = -0.45;
    body.add(h);
  }
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.76), tail);
  t.position.set(-2.355, 0.78, 0);
  body.add(t);

  // wheels
  const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 28);
  tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.31, 28);
  rimGeo.rotateX(Math.PI / 2);
  // five spokes, slightly proud of the rim face
  const spokeGeo = new THREE.BoxGeometry(0.42, 0.06, 0.33);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2c2d31, metalness: 0.85, roughness: 0.35, envMap, envMapIntensity: 0.4 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x8d9095, metalness: 0.9, roughness: 0.3, envMap, envMapIntensity: 0.5 });
  const wheels = [];
  for (const x of [-1.36, 1.36]) {
    for (const z of [-0.78, 0.78]) {
      const w = new THREE.Group();
      w.position.set(x, WHEEL_R, z);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      w.add(tire, new THREE.Mesh(rimGeo, rimMat));
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(spokeGeo, spokeMat);
        sp.rotation.z = (k / 5) * Math.PI;
        w.add(sp);
      }
      body.add(w);
      wheels.push(w);
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
  for (const x of [-1.15, 1.15]) for (const z of [-0.55, 0.55]) addJet('lift', [x, 0.3, z], [0, -1, 0], 2.4, 1.15);
  // pitch: nose-up fires under the nose and over the tail
  addJet('noseUp', [2.0, 0.34, 0], [0, -1, 0], 1.3, 0.8);
  addJet('noseUp', [-2.0, 0.95, 0], [0, 1, 0], 1.3, 0.8);
  addJet('noseDown', [2.0, 0.72, 0], [0, 1, 0], 1.3, 0.8);
  addJet('noseDown', [-2.05, 0.38, 0], [0, -1, 0], 1.3, 0.8);
  for (const z of [-0.42, 0.42]) addJet('boost', [-2.25, 0.55, z], [-1, 0, 0], 2.6, 1.1);

  // a light under the car that washes the ground while the lift jets fire
  const jetLight = new THREE.PointLight(0xcfe0ff, 0, 18, 1.6);
  jetLight.position.set(0, -0.4, 0);
  body.add(jetLight);

  // headlight beam
  const beam = new THREE.SpotLight(0xffffff, 60, 45, 0.45, 0.6, 1.2);
  beam.position.set(2.1, 0.6, 0);
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
