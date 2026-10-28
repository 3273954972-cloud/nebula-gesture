import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  公共 GLSL
 * ------------------------------------------------------------------ */
const HSL = /* glsl */`
vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}`;

const POINT_VERT = /* glsl */`
attribute float aSize;
attribute float aHue;
attribute float aAlpha;
uniform float uPixelRatio;
uniform float uHueShift;
uniform float uHueSpread;
uniform float uGlow;
varying vec3 vCol;
varying float vA;
${HSL}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float h = fract(aHue + uHueShift);
  vCol = hsl2rgb(vec3(h, 0.95, 0.56 + 0.16 * aAlpha));
  vA = aAlpha;
  float d = max(1.0, -mv.z);
  gl_PointSize = clamp(aSize * uPixelRatio * uGlow * (1000.0 / d), 1.0, 72.0);
}`;

const POINT_FRAG = /* glsl */`
varying vec3 vCol;
varying float vA;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float a = pow(core, 1.7) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
}`;

const LINE_VERT = /* glsl */`
attribute float aHue;
attribute float aFade;
uniform float uHueShift;
varying vec3 vCol;
varying float vF;
${HSL}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vCol = hsl2rgb(vec3(fract(aHue + uHueShift), 0.9, 0.62));
  vF = aFade;
}`;

const LINE_FRAG = /* glsl */`
varying vec3 vCol;
varying float vF;
void main() {
  if (vF < 0.004) discard;
  gl_FragColor = vec4(vCol, vF);
}`;

/* ------------------------------------------------------------------ *
 *  主粒子场
 * ------------------------------------------------------------------ */
export class ParticleField {
  constructor(scene, max = 26000) {
    this.max = max;
    this.n = 0;
    this.energy = 0;        // 爆炸余能，用来提亮
    this.shock = 0;         // 冲击波半径
    this.shockPos = new THREE.Vector3();

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.tgt = new Float32Array(max * 3);
    this.hue = new Float32Array(max);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.pha = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aHue', new THREE.BufferAttribute(this.hue, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));

    this.uniforms = {
      uPixelRatio: { value: 1 },
      uHueShift: { value: 0.5 },
      uHueSpread: { value: 1 },
      uGlow: { value: 1 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    /* 拖尾线段：每个粒子一条，从 (pos - vel*k) 到 pos */
    this.streakPos = new Float32Array(max * 6);
    this.streakHue = new Float32Array(max * 2);
    this.streakFade = new Float32Array(max * 2);

    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3));
    sgeo.setAttribute('aHue', new THREE.BufferAttribute(this.streakHue, 1));
    sgeo.setAttribute('aFade', new THREE.BufferAttribute(this.streakFade, 1));

    this.streakUniforms = { uHueShift: this.uniforms.uHueShift };
    const smat = new THREE.ShaderMaterial({
      uniforms: this.streakUniforms,
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.streaks = new THREE.LineSegments(sgeo, smat);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 4;
    scene.add(this.streaks);
  }

  /* 调整活跃粒子数（滑块 / 自动降级） */
  setCount(n) {
    n = Math.max(200, Math.min(this.max, Math.round(n)));
    const from = this.n;
    if (n > from) {
      for (let i = from; i < n; i++) {
        const i3 = i * 3;
        const a = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 2.4;
        this.pos[i3] = Math.cos(a) * r;
        this.pos[i3 + 1] = (Math.random() - 0.5) * 2.4;
        this.pos[i3 + 2] = Math.sin(a) * r;
        this.hue[i] = Math.random() * 0.35;
        this.siz[i] = 0.042 + Math.random() * 0.058;
        this.alp[i] = 0.55 + Math.random() * 0.45;
        this.pha[i] = Math.random();
        this.tgt[i3] = this.pos[i3];
        this.tgt[i3 + 1] = this.pos[i3 + 1];
        this.tgt[i3 + 2] = this.pos[i3 + 2];
        this.streakHue[i * 2] = this.streakHue[i * 2 + 1] = this.hue[i];
      }
    }
    this.n = n;
    this._hueKey = null;
    this.points.geometry.setDrawRange(0, n);
    this.streaks.geometry.setDrawRange(0, n * 2);
  }

  /* 把标准形状（半径≈1）摆到 center 处，scale 缩放 */
  setShape(base, center, scale, spread = 1, hueKey = '') {
    const n = this.n;
    const tx = this.tgt;
    const hue = this.hue;
    const hueDirty = this._hueKey !== hueKey;
    this._hueKey = hueKey;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const bx = base[i3], by = base[i3 + 1], bz = base[i3 + 2];
      tx[i3] = center.x + bx * scale;
      tx[i3 + 1] = center.y + by * scale;
      tx[i3 + 2] = center.z + bz * scale;
      if (hueDirty) {
        // 霓虹渐变：竖向 + 径向 + 抖动
        const rad = Math.sqrt(bx * bx + by * by + bz * bz);
        hue[i] = (by * 0.5 + 0.5) * 0.5 + rad * 0.22 + this.hueSeed(i) * 0.16;
        this.streakHue[i * 2] = this.streakHue[i * 2 + 1] = hue[i];
      }
    }
    if (hueDirty) {
      this.points.geometry.attributes.aHue.needsUpdate = true;
      this.streaks.geometry.attributes.aHue.needsUpdate = true;
    }
  }

  hueSeed(i) {
    // 稳定伪随机，避免每次换形状色彩闪烁
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /* 粒子扩散（右手捏合/按键）*/
  explode(point, power = 9) {
    const n = this.n;
    const px = this.pos, vv = this.vel;
    const cx = point.x, cy = point.y, cz = point.z;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let dx = px[i3] - cx, dy = px[i3 + 1] - cy, dz = px[i3 + 2] - cz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const falloff = 1 / (1 + d * 0.35);
      const p = power * falloff * (0.7 + Math.random() * 0.8);
      vv[i3] += (dx / d) * p;
      vv[i3 + 1] += (dy / d) * p + 1.2 * falloff;
      vv[i3 + 2] += (dz / d) * p;
    }
    this.energy = 1;
    this.shock = 0.02;
    this.shockPos.copy(point);
  }

  /* 冲击波外扩（视觉上的一圈亮环，靠 tgt 半径临时放大实现） */
  updateShock(dt) {
    if (this.shock > 0) {
      this.shock += dt * 12;
      if (this.shock > 4.2) this.shock = 0;
    }
  }

  update(dt, t, p) {
    const n = this.n;
    if (n === 0) return;

    const px = this.pos, vv = this.vel, tx = this.tgt, ph = this.pha;
    const stiff = p.stiffness;
    const damp = Math.pow(p.damping, dt * 60);
    const swirl = p.swirl;
    const trail = p.trail;
    const stag = p.stagger;

    const sp = this.streakPos, sf = this.streakFade;
    const doStreak = trail > 0.02;
    const kx = trail * 0.075;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const phase = ph[i] * 6.2831853;

      // 弹簧回归
      let dx = tx[i3] - px[i3];
      let dy = tx[i3 + 1] - px[i3 + 1];
      let dz = tx[i3 + 2] - px[i3 + 2];

      vv[i3] += dx * stiff * dt;
      vv[i3 + 1] += dy * stiff * dt;
      vv[i3 + 2] += dz * stiff * dt;

      // 有机漂移
      if (swirl > 0.001) {
        const s1 = Math.sin(t * 1.7 + phase + px[i3 + 1] * 0.55);
        const s2 = Math.cos(t * 1.3 + phase * 1.7 + px[i3] * 0.4);
        vv[i3] += s1 * swirl * dt;
        vv[i3 + 1] += s2 * swirl * 0.8 * dt;
        vv[i3 + 2] += (s1 + s2) * 0.5 * swirl * dt;
      }

      // 阻尼
      vv[i3] *= damp;
      vv[i3 + 1] *= damp;
      vv[i3 + 2] *= damp;

      px[i3] += vv[i3] * dt;
      px[i3 + 1] += vv[i3 + 1] * dt;
      px[i3 + 2] += vv[i3 + 2] * dt;

      if (doStreak) {
        const i6 = i * 6;
        const i2 = i * 2;
        sp[i6] = px[i3] - vv[i3] * kx;
        sp[i6 + 1] = px[i3 + 1] - vv[i3 + 1] * kx;
        sp[i6 + 2] = px[i3 + 2] - vv[i3 + 2] * kx;
        sp[i6 + 3] = px[i3];
        sp[i6 + 4] = px[i3 + 1];
        sp[i6 + 5] = px[i3 + 2];
        const spd = Math.abs(vv[i3]) + Math.abs(vv[i3 + 1]) + Math.abs(vv[i3 + 2]);
        const f = Math.min(1, spd * 0.5) * trail;
        sf[i2] = 0;
        sf[i2 + 1] = f * 0.85;
      }
    }

    const pg = this.points.geometry;
    pg.attributes.position.needsUpdate = true;
    if (doStreak) {
      this.streaks.geometry.attributes.position.needsUpdate = true;
      this.streaks.geometry.attributes.aFade.needsUpdate = true;
    }
    this.streaks.visible = doStreak;

    this.energy *= Math.pow(0.12, dt);
    this.uniforms.uGlow.value = p.glow * (1 + this.energy * 0.9);
    this.uniforms.uPixelRatio.value = p.pixelRatio;
    this.uniforms.uHueSpread.value = stag;
    if (this.trailPulse !== undefined) this.trailPulse += dt;
  }
}

/* ------------------------------------------------------------------ *
 *  爱心粒子流 / 爆炸火花
 * ------------------------------------------------------------------ */
export class SparkEmitter {
  constructor(scene, max = 2600) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.hue = new Float32Array(max);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.free = [];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aHue', new THREE.BufferAttribute(this.hue, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));

    this.uniforms = {
      uPixelRatio: { value: 1 },
      uHueShift: { value: 0.5 },
      uHueSpread: { value: 1 },
      uGlow: { value: 1.2 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this._heartAcc = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size, hue) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.siz[i] = size; this.hue[i] = hue; this.alp[i] = 0;
    this.points.geometry.setDrawRange(0, this.n);
  }

  /* 捏合爆炸火花 */
  burst(point, count, hueBase) {
    const c = Math.min(count, 220);
    for (let k = 0; k < c; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 4 + Math.random() * 11;
      this.spawn(
        point.x, point.y, point.z,
        Math.sin(ph) * Math.cos(th) * sp,
        Math.cos(ph) * sp * 0.85 + 2,
        Math.sin(ph) * Math.sin(th) * sp,
        0.55 + Math.random() * 0.9,
        0.042 + Math.random() * 0.06,
        hueBase + Math.random() * 0.28
      );
    }
  }

  /* 比心：从心形表面持续飘出 */
  heartStream(dt, center, scale, hueBase) {
    this._heartAcc += dt * 220;
    let k = Math.floor(this._heartAcc);
    this._heartAcc -= k;
    k = Math.min(k, 26);
    for (let j = 0; j < k; j++) {
      const t = Math.random() * Math.PI * 2;
      const r = 0.85 + Math.random() * 0.2;
      const hx = 0.0625 * 16 * Math.pow(Math.sin(t), 3) * r;
      const hy = 0.0625 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * r;
      this.spawn(
        center.x + hx * scale, center.y + hy * scale, center.z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 1.5, (Math.random() - 0.5) * 0.5,
        1.6 + Math.random() * 1.4,
        0.036 + Math.random() * 0.05,
        hueBase + 0.86 + Math.random() * 0.12
      );
    }
  }

  update(dt, hueShift) {
    const n = this.n;
    let w = 0;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.vel[i3 + 1] += 0.6 * dt;
      this.vel[i3] *= 0.985;
      this.vel[i3 + 2] *= 0.985;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const lr = this.life[i] / this.maxLife[i];
      this.alp[i] = Math.min(1, lr * 2.2) * Math.min(1, (1 - lr) * 8 + 0.25);

      if (w !== i) {
        const w3 = w * 3;
        this.pos[w3] = this.pos[i3]; this.pos[w3 + 1] = this.pos[i3 + 1]; this.pos[w3 + 2] = this.pos[i3 + 2];
        this.vel[w3] = this.vel[i3]; this.vel[w3 + 1] = this.vel[i3 + 1]; this.vel[w3 + 2] = this.vel[i3 + 2];
        this.hue[w] = this.hue[i]; this.siz[w] = this.siz[i];
        this.alp[w] = this.alp[i]; this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i];
      }
      w++;
    }
    this.n = w;
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    g.attributes.position.needsUpdate = true;
    g.attributes.aHue.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    this.uniforms.uHueShift.value = hueShift;
  }
}

/* ------------------------------------------------------------------ *
 *  手势轨迹流光
 * ------------------------------------------------------------------ */
export class TrailLine {
  constructor(scene, len = 46, hue = 0.5) {
    this.len = len;
    this.hue = hue;
    const pts = new Float32Array(len * 3);
    const fade = new Float32Array(len);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.setAttribute('aHue', new THREE.BufferAttribute(new Float32Array(len).fill(hue), 1));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uHueShift: { value: 0 } },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pts = pts;
    this.fade = fade;
    this.geo = geo;
    this.line = new THREE.Line(geo, mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 7;
    this.line.visible = false;
    scene.add(this.line);
    this.filled = 0;
  }

  push(x, y, z) {
    const n = this.len;
    for (let i = n - 1; i > 0; i--) {
      const a = i * 3, b = (i - 1) * 3;
      this.pts[a] = this.pts[b];
      this.pts[a + 1] = this.pts[b + 1];
      this.pts[a + 2] = this.pts[b + 2];
    }
    this.pts[0] = x; this.pts[1] = y; this.pts[2] = z;
    this.filled = Math.min(this.filled + 1, n);
    this.geo.setDrawRange(0, Math.max(2, this.filled));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.fade[i] = this.filled < 3 ? 0 : Math.pow(1 - t, 1.6) * 0.9;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
    this.line.visible = true;
  }

  setHue(h) {
    const attr = this.geo.attributes.aHue;
    for (let i = 0; i < this.len; i++) attr.array[i] = h;
    attr.needsUpdate = true;
  }
}
