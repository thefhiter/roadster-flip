// One pooled Points system for thruster smoke, landing dust and crash sparks.
import * as THREE from 'three';

const MAX = 4000;

const vert = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const frag = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
  }
`;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.a0 = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);   // 0 smoke, 1 spark
    this.head = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;

    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.smokeMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  setViewport(heightPx, fovDeg) {
    this.smokeMat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(x, y, z, vx, vy, vz, { life = 1.6, size = 0.6, grow = 2.2, alpha = 0.5, color = [0.82, 0.83, 0.85], kind = 0 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.color[i3] = color[0]; this.color[i3 + 1] = color[1]; this.color[i3 + 2] = color[2];
    this.life[i] = life * (0.75 + Math.random() * 0.5);
    this.age[i] = 0;
    this.size[i] = size;
    this.grow[i] = grow;
    this.a0[i] = alpha;
    this.alpha[i] = alpha;
    this.kind[i] = kind;
  }

  dust(x, y, z, strength = 1) {
    const n = Math.round(30 * strength);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 7) * strength;
      this.spawn(x + (Math.random() - 0.5) * 3, y + 0.2, z + (Math.random() - 0.5) * 3,
        Math.cos(a) * sp, Math.random() * 1.5, Math.sin(a) * sp,
        { life: 1.8, size: 1.2, grow: 3.5, alpha: 0.32 * Math.min(1.5, strength), color: [0.6, 0.6, 0.6] });
    }
  }

  sparks(x, y, z, strength = 1) {
    const n = Math.round(26 * strength);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI;
      const sp = 4 + Math.random() * 12 * strength;
      this.spawn(x, y, z + (Math.random() - 0.5) * 1.6, Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.5) * 6,
        { life: 0.55, size: 0.16, grow: -0.1, alpha: 1, color: [3.2, 1.2, 0.35], kind: 1 });
    }
  }

  update(dt, gravity = 9.81) {
    for (let i = 0; i < MAX; i++) {
      if (this.alpha[i] <= 0 && this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.alpha[i] = 0; continue; }
      const i3 = i * 3;
      if (this.kind[i] === 1) {
        this.vel[i3 + 1] -= gravity * dt;
        if (this.pos[i3 + 1] < 0.02 && this.vel[i3 + 1] < 0) { this.vel[i3 + 1] *= -0.4; this.vel[i3] *= 0.6; }
        this.alpha[i] = this.a0[i] * (1 - t);
      } else {
        // smoke: drag, slight buoyancy, grows and fades
        const d = Math.exp(-2.4 * dt);
        this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d + 0.6 * dt; this.vel[i3 + 2] *= d;
        this.size[i] += this.grow[i] * dt;
        this.alpha[i] = this.a0[i] * (t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92);
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.kind[i] === 0 && this.pos[i3 + 1] < 0.1) { this.pos[i3 + 1] = 0.1; this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]) * 0.2; }
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    this.age.fill(1e9);
  }
}
