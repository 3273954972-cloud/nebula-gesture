/* 形状采样：全部归一到半径 ≈ 1，由主程序乘缩放 */

const TAU = Math.PI * 2;

function sphere(n) {
  const out = new Float32Array(n * 3);
  const gold = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = gold * i;
    // 让一部分粒子落在内层，形成体积感
    const k = i % 5 === 0 ? 0.45 + Math.random() * 0.3 : 0.96 + Math.random() * 0.06;
    out[i * 3] = Math.cos(th) * r * k;
    out[i * 3 + 1] = y * k;
    out[i * 3 + 2] = Math.sin(th) * r * k;
  }
  return out;
}

function nebula(n) {
  const out = new Float32Array(n * 3);
  const arms = 3;
  for (let i = 0; i < n; i++) {
    const arm = i % arms;
    const t = Math.pow(Math.random(), 0.62);
    const ang = t * 4.6 + (arm / arms) * TAU + (Math.random() - 0.5) * 0.55;
    const rad = 0.18 + t * 0.95;
    const thick = (1 - t) * 0.5 + 0.06;
    out[i * 3] = Math.cos(ang) * rad + (Math.random() - 0.5) * thick * 0.6;
    out[i * 3 + 1] = (Math.random() - 0.5) * thick * 1.7;
    out[i * 3 + 2] = Math.sin(ang) * rad + (Math.random() - 0.5) * thick * 0.6;
  }
  return out;
}

function heart(n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.random() * TAU;
    const r = Math.pow(Math.random(), 0.55);
    const hx = 0.0625 * 16 * Math.pow(Math.sin(t), 3);
    const hy = 0.0625 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    out[i * 3] = hx * r + (Math.random() - 0.5) * 0.035;
    out[i * 3 + 1] = hy * r * 1.06 - 0.05 + (Math.random() - 0.5) * 0.035;
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.22 * r;
  }
  return out;
}

function vortex(n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const R = 0.62 + Math.random() * 0.3;
    const tube = 0.16 * Math.sqrt(Math.random());
    const b = Math.random() * TAU;
    out[i * 3] = (R + tube * Math.cos(b)) * Math.cos(a);
    out[i * 3 + 1] = tube * Math.sin(b) * 1.4 + (Math.random() - 0.5) * 0.06;
    out[i * 3 + 2] = (R + tube * Math.cos(b)) * Math.sin(a);
  }
  return out;
}

/* 文字采样：把文字画到离屏 canvas，取不透明像素；按包围盒归一化到宽度 2 */
function textPoints(n, text = 'Hello') {
  const W = 1024, H = 320;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 190px "Arial Black", "Microsoft YaHei", Arial, sans-serif';
  ctx.fillText(text, W / 2, H / 2 + 4);

  const img = ctx.getImageData(0, 0, W, H).data;
  const step = 3;
  const pts = [];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (img[(y * W + x) * 4] > 128) {
        pts.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const count = Math.max(1, pts.length / 2);
  const wpx = Math.max(1, maxX - minX);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = 2.0 / wpx;

  const out = new Float32Array(n * 3);
  const GOLD = 0.6180339887498949;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(((i * GOLD) % 1) * count);
    const px = pts[k * 2] - cx;
    const py = pts[k * 2 + 1] - cy;
    out[i * 3] = px * sx + (Math.random() - 0.5) * 0.012;
    out[i * 3 + 1] = -py * sx + (Math.random() - 0.5) * 0.012;
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.07;
  }
  return out;
}

const builders = { sphere, nebula, heart, vortex };

const cache = new Map();

export function makeBase(name, n) {
  const key = name + ':' + n;
  if (cache.has(key)) return cache.get(key);
  let out;
  if (name === 'text') out = textPoints(n, 'Hello');
  else out = (builders[name] || nebula)(n);
  cache.set(key, out);
  return out;
}

export function clearShapeCache() {
  cache.clear();
}
