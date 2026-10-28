import * as THREE from 'three';

/* 程序化生成光点纹理（不依赖外部图片） */
function glowTexture(size = 64, hardness = 0.15) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * hardness, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* 散景圆盘：中心接近实心、边缘柔化，模拟失焦光斑 */
function bokehTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PALETTE = [
  [0.78, 0.92, 1.0],
  [0.35, 0.95, 1.0],
  [1.0, 0.45, 0.95],
  [0.65, 0.62, 1.0],
  [1.0, 1.0, 1.0],
];

function buildLayer({ count, zNear, zFar, size, opacity, sharp, spread = 90, ySpread = 46 }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    pos[i3] = (Math.random() - 0.5) * spread;
    pos[i3 + 1] = (Math.random() - 0.5) * ySpread;
    pos[i3 + 2] = zNear + Math.random() * (zFar - zNear);
    const c = PALETTE[(Math.random() * PALETTE.length) | 0];
    const k = 0.5 + Math.random() * 0.5;
    col[i3] = c[0] * k;
    col[i3 + 1] = c[1] * k;
    col[i3 + 2] = c[2] * k;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    map: glowTexture(sharp ? 64 : 48, sharp ? 0.05 : 0.3),
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, mat, baseOpacity: opacity, speed: 0.4 + Math.random() * 0.5 };
}

export class StarField {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.layers = [
      // 远景：偏虚、偏大 → 景深深处的散焦
      buildLayer({ count: 1500, zNear: -140, zFar: -60, size: 1.5, opacity: 0.42, sharp: false, spread: 160, ySpread: 90 }),
      buildLayer({ count: 900, zNear: -60, zFar: -24, size: 1.05, opacity: 0.5, sharp: false, spread: 110, ySpread: 64 }),
      // 中景：实焦
      buildLayer({ count: 420, zNear: -24, zFar: -6, size: 0.72, opacity: 0.85, sharp: true, spread: 70, ySpread: 40 }),
      // 近景：贴近镜头，做视差
      buildLayer({ count: 90, zNear: -4, zFar: 10, size: 1.9, opacity: 0.55, sharp: true, spread: 44, ySpread: 26 }),
    ];
    for (const l of this.layers) {
      this.group.add(l.pts);
      l.pts.renderOrder = -2;
    }

    /* 失焦光斑（前景散景） */
    const bokehCount = 34;
    const bpos = new Float32Array(bokehCount * 3);
    const bcol = new Float32Array(bokehCount * 3);
    for (let i = 0; i < bokehCount; i++) {
      const i3 = i * 3;
      bpos[i3] = (Math.random() - 0.5) * 70;
      bpos[i3 + 1] = (Math.random() - 0.5) * 40;
      bpos[i3 + 2] = -34 + Math.random() * 26;
      const c = PALETTE[(Math.random() * PALETTE.length) | 0];
      bcol[i3] = c[0]; bcol[i3 + 1] = c[1]; bcol[i3 + 2] = c[2];
    }
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bgeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
    this.bokehMat = new THREE.PointsMaterial({
      map: bokehTexture(128),
      size: 6.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.bokeh = new THREE.Points(bgeo, this.bokehMat);
    this.bokeh.frustumCulled = false;
    this.bokeh.renderOrder = -1;
    this.group.add(this.bokeh);

    this.t = 0;
    this._base = this.layers.map((l) => l.baseOpacity);
  }

  update(dt, parallax, brightness = 1) {
    this.t += dt;
    const t = this.t;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      const depth = i === 3 ? 1.6 : i === 2 ? 1.0 : i === 1 ? 0.5 : 0.18;
      l.pts.position.x = -parallax.x * depth * 3;
      l.pts.position.y = -parallax.y * depth * 3;
      l.pts.rotation.z += dt * 0.008 * l.speed * (i % 2 ? -1 : 1);
      l.mat.opacity = l.baseOpacity * brightness * (0.82 + 0.18 * Math.sin(t * (0.5 + i * 0.13) + i));
    }
    this.bokeh.position.x = -parallax.x * 2.4;
    this.bokeh.position.y = -parallax.y * 2.4;
    this.bokehMat.opacity = 0.16 * brightness * (0.75 + 0.25 * Math.sin(t * 0.37));
    this.bokeh.rotation.z = Math.sin(t * 0.05) * 0.15;
  }
}
