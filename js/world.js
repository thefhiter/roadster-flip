// Static scenery for each level, generated from the same Track objects the
// physics uses, so what you see is exactly what you drive on.
import * as THREE from 'three';
import { buildParkedCar } from './car.js';

const TRACK_WIDTH = 5.2;
const THICK = 0.55;
const LIFT = 0.04;   // riding face sits a hair above the physics line

let surfaceTexture = null;
function getSurfaceTexture() {
  if (surfaceTexture) return surfaceTexture;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8d8d89';
  g.fillRect(0, 0, 512, 256);
  // concrete speckle
  const img = g.getImageData(0, 0, 512, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // rubber marks down the middle
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(30,30,30,${Math.random() * 0.06})`;
    const y = 128 + (Math.random() - 0.5) * 110;
    g.fillRect(0, y, 512, 6 + Math.random() * 16);
  }
  // darker edge bands and a fine line inside each
  g.fillStyle = 'rgba(20,20,20,0.35)';
  g.fillRect(0, 0, 512, 22); g.fillRect(0, 234, 512, 22);
  g.fillStyle = 'rgba(240,240,236,0.55)';
  g.fillRect(0, 30, 512, 2); g.fillRect(0, 224, 512, 2);
  // panel seam
  g.fillStyle = 'rgba(15,15,15,0.5)';
  g.fillRect(0, 0, 3, 256);
  surfaceTexture = new THREE.CanvasTexture(c);
  surfaceTexture.wrapS = THREE.RepeatWrapping;
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.anisotropy = 8;
  return surfaceTexture;
}

// Ribbon with thickness along a track between arc lengths s0 and s1.
// The riding face is on the +normal side; the slab hangs off the -normal side.
function ribbonGeometry(track, s0, s1, width = TRACK_WIDTH, thick = THICK) {
  const step = 0.3;
  const n = Math.max(2, Math.ceil((s1 - s0) / step));
  const pos = [], nor = [], uv = [], idx = [];
  const p = {};
  const hw = width / 2;
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  // four strips: top, bottom, near side, far side
  const strips = [
    { z0: -hw, z1: hw, off: LIFT, normal: 1 },
    { z0: hw, z1: -hw, off: LIFT - thick, normal: -1 },
    { side: hw },
    { side: -hw },
  ];
  for (const st of strips) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      track.pointAt(s, p);
      if (st.side === undefined) {
        const ox = p.nx * st.off, oy = p.ny * st.off;
        pos.push(p.x + ox, p.y + oy, st.z0, p.x + ox, p.y + oy, st.z1);
        nor.push(p.nx * st.normal, p.ny * st.normal, 0, p.nx * st.normal, p.ny * st.normal, 0);
        uv.push(s / 7, 0, s / 7, 1);
      } else {
        pos.push(p.x + p.nx * LIFT, p.y + p.ny * LIFT, st.side, p.x - p.nx * (thick - LIFT), p.y - p.ny * (thick - LIFT), st.side);
        const nz = Math.sign(st.side);
        nor.push(0, 0, nz, 0, 0, nz);
        uv.push(s / 7, 0, s / 7, 0.1);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      if (st.side === undefined) quad(a, a + 1, a + 3, a + 2);
      else if (st.side > 0) quad(a, a + 2, a + 3, a + 1);
      else quad(a, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function edgeLines(track, s0, s1, width = TRACK_WIDTH) {
  const pts = [];
  const p = {};
  const n = Math.ceil((s1 - s0) / 0.5);
  for (const z of [-width / 2, width / 2]) {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      track.pointAt(s0 + ((s1 - s0) * i) / n, p);
      const cur = [p.x + p.nx * (LIFT + 0.02), p.y + p.ny * (LIFT + 0.02), z];
      if (prev) pts.push(...prev, ...cur);
      prev = cur;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
}

// Box lattice with face diagonals — the scaffolding look from the reference.
function lattice(x0, x1, y0, y1, z0, z1, cell = 3) {
  const nx = Math.max(1, Math.round((x1 - x0) / cell));
  const ny = Math.max(1, Math.round((y1 - y0) / cell));
  const nz = Math.max(1, Math.round((z1 - z0) / cell));
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny, dz = (z1 - z0) / nz;
  const P = [];
  const L = (a, b) => P.push(...a, ...b);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) {
    const x = x0 + i * dx, y = y0 + j * dy, z = z0 + k * dz;
    if (i < nx) L([x, y, z], [x + dx, y, z]);
    if (j < ny) L([x, y, z], [x, y + dy, z]);
    if (k < nz) L([x, y, z], [x, y, z + dz]);
    // diagonals on the outer faces only
    if (i < nx && j < ny && (k === 0 || k === nz)) L([x, y, z], [x + dx, y + dy, z]);
    if (k < nz && j < ny && (i === 0 || i === nx)) L([x, y, z], [x, y + dy, z + dz]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
}

function groundGrid() {
  const P = [];
  for (let z = -120; z <= 120; z += 15) P.push(-900, 0.01, z, 900, 0.01, z);
  for (let x = -900; x <= 900; x += 30) P.push(x, 0.01, -120, x + 40, 0.01, 120);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045 }));
}

// Approach strip: a thin glowing red guide with white distance ticks.
function runway(x0, x1) {
  const grp = new THREE.Group();
  const red = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0, 0.02, 0.09),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.1, 0.22, 0.09) }),
  );
  red.position.set((x0 + x1) / 2, 0.02, TRACK_WIDTH / 2 + 0.6);
  grp.add(red);
  const tickGeo = new THREE.BoxGeometry(0.12, 0.03, 0.12);
  const count = Math.floor((x1 - x0) / 10);
  const ticks = new THREE.InstancedMesh(tickGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2) }), count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(x1 - i * 10, 0.03, TRACK_WIDTH / 2 + 0.6);
    ticks.setMatrixAt(i, m);
  }
  grp.add(ticks);
  // faint lane edges
  const P = [];
  for (const z of [-TRACK_WIDTH / 2, TRACK_WIDTH / 2]) P.push(x0, 0.015, z, x1, 0.015, z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 })));
  return grp;
}

export function buildWorld(scene, level) {
  const grp = new THREE.Group();
  grp.name = `world-${level.id}`;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 600),
    new THREE.MeshStandardMaterial({ color: 0x0b0b0a, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  grp.add(ground, groundGrid());

  const surfMat = new THREE.MeshStandardMaterial({ map: getSurfaceTexture(), roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide });
  const ramp = (track, s0, s1) => {
    const m = new THREE.Mesh(ribbonGeometry(track, s0, s1), surfMat);
    m.castShadow = m.receiveShadow = true;
    grp.add(m, edgeLines(track, s0, s1));
    return m;
  };

  const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.32, 0.1) });

  if (level.id === 'jramp') {
    const tr = level.main;
    grp.add(runway(-400, level.rampS0 - 400));
    ramp(tr, level.rampS0, tr.length);
    const { R1, topY } = level.dims;
    const end = tr.pointAt(tr.length);
    // scaffold tower behind the wall and a cap over the ceiling
    grp.add(lattice(R1 + 0.6, R1 + 6.6, 0, topY + 3, -4.5, 4.5));
    grp.add(lattice(end.x - 0.4, R1 + 0.6, topY + 0.6, topY + 3, -4.5, 4.5));
    // orange lip strip at the end of the ceiling, as in the reference
    const lip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, TRACK_WIDTH * 0.92), accent);
    lip.position.set(end.x + 1.6, end.y - 0.04, 0);
    grp.add(lip);
    // ceiling marker strips every few metres
    const mk = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6) });
    for (let s = level.ceilingS0 + 1; s < tr.length - 1; s += 2) {
      const q = tr.pointAt(s);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.9), mk);
      b.position.set(q.x, q.y - 0.03, TRACK_WIDTH / 2 - 0.7);
      grp.add(b);
    }
  } else {
    const [main, , landing] = level.tracks;
    grp.add(runway(-300, level.rampS0 - 300));
    ramp(main, level.rampS0, main.length);
    // kicker support and its front face
    const lip = main.pointAt(main.length);
    grp.add(lattice(lip.x - 7, lip.x, 0, lip.y - 0.4, -2.6, 2.6, 2));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.06, lip.y, TRACK_WIDTH), accent);
    face.position.set(lip.x, lip.y / 2, 0);
    grp.add(face);
    // landing ramp + its lattice
    ramp(landing, 0, landing.length);
    const ls = landing.pointAt(0);
    grp.add(lattice(ls.x, ls.x + 4, 0, ls.y - 0.6, -2.6, 2.6, 2));
    // parked cars
    level.parked = [];
    for (const o of level.obstacles) {
      const pc = buildParkedCar(o.w, o.h);
      pc.group.position.set(o.x + o.w / 2, o.y, (o.i % 2 ? -0.25 : 0.25));
      pc.group.rotation.y = (o.i % 2 ? 1 : -1) * 0.04;
      grp.add(pc.group);
      level.parked.push(pc);
    }
    // landing zone stripe on the ground
    const zone = new THREE.Mesh(new THREE.BoxGeometry(20, 0.02, 0.09), accent);
    zone.position.set(ls.x + 18, 0.02, TRACK_WIDTH / 2 + 0.6);
    grp.add(zone);
  }

  scene.add(grp);
  return grp;
}

// Bounding box of everything interesting, used by the camera on the title screen.
export function levelShowcase(level) {
  return level.focus;
}
