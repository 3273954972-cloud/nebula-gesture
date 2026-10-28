import * as THREE from 'three';
import { ParticleField, SparkEmitter, TrailLine } from './particles.js';
import { StarField } from './starfield.js';
import { HandTracker } from './tracker.js';
import { GestureEngine, GESTURE_CN } from './gestures.js';
import { Overlay } from './overlay.js';
import { GifRecorder, downloadBlob } from './gif.js';
import { makeBase } from './shapes.js';
import { DemoHands } from './demo.js';

/* ------------------------------------------------------------------ *
 *  常量 / 参数
 * ------------------------------------------------------------------ */
const MAX_PARTICLES = 26000;
const SHAPE_SCALE = { nebula: 4.0, heart: 4.2, text: 5.6, sphere: 3.6, vortex: 4.0 };
const SHAPES = ['nebula', 'heart', 'text', 'sphere', 'vortex'];

const qs = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* 出错时把信息显示在页面上，方便现场排查（不会只留一个黑屏） */
function fatal(msg) {
  let box = document.getElementById('fatalBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatalBox';
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:999;padding:12px 14px;' +
      'border-radius:12px;background:rgba(60,4,10,.92);border:1px solid #ff3df0;color:#ffd9e6;' +
      'font:12px/1.6 Consolas,monospace;white-space:pre-wrap;max-height:38vh;overflow:auto';
    document.body.appendChild(box);
  }
  box.textContent = '⚠ ' + msg;
}
window.addEventListener('error', (e) => fatal(e.message || String(e.error || 'unknown error')));
window.addEventListener('unhandledrejection', (e) => fatal('Promise: ' + ((e.reason && e.reason.message) || e.reason)));

const P = {
  density: +(qs.get('n') || 8000),
  trail: 0.55,
  glow: 1,
  hue: 0.52,
  star: 1,
  autoQuality: true,
  autoHue: true,
  showPreview: true,
};

/* ------------------------------------------------------------------ *
 *  渲染基础
 * ------------------------------------------------------------------ */
const canvas = el('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance',
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x02030a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 0, 16);

const stars = new StarField(scene);
const particles = new ParticleField(scene, MAX_PARTICLES);
const sparks = new SparkEmitter(scene, 2600);
const trailA = new TrailLine(scene, 44, 0.55);
const trailB = new TrailLine(scene, 44, 0.85);
const trails = [trailA, trailB];

const engine = new GestureEngine();
const tracker = new HandTracker();
const overlay = new Overlay(el('previewCanvas'));
const gif = new GifRecorder();
const demo = new DemoHands({ gesture: qs.get('g') || null });

/* 预生成形状，避免第一次比心/比耶卡一下 */
const shapeCache = {};
for (const s of SHAPES) shapeCache[s] = makeBase(s, MAX_PARTICLES);

/* ------------------------------------------------------------------ *
 *  运行状态
 * ------------------------------------------------------------------ */
const S = {
  mode: 'idle',
  hue: 0.52,
  hueTarget: 0.52,
  glowBoost: 1,
  center: new THREE.Vector3(),
  centerT: new THREE.Vector3(),
  scale: SHAPE_SCALE.nebula,
  scaleT: SHAPE_SCALE.nebula,
  shape: 'nebula',
  gesture: 'none',
  gestureUntil: 0,
  manual: null,
  shake: 0,
  hands: [],
  fps: 60,
  quality: 1,
  lastQuality: 0,
  parallax: new THREE.Vector2(),
  booted: false,
  recording: false,
};

let view = { w: 26, h: 14 };
function updateView() {
  const v = THREE.MathUtils.degToRad(camera.fov);
  const h = 2 * Math.tan(v / 2) * camera.position.z;
  view = { w: h * camera.aspect, h };
}
updateView();

const tmpV = new THREE.Vector3();
function palmToWorld(p, out = tmpV) {
  return out.set((p.x - 0.5) * view.w * 0.94, (0.5 - p.y) * view.h * 0.94, 0);
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function showToast(text, progress) {
  const t = el('toast');
  el('toastText').textContent = text;
  const bar = el('toast').querySelector('.bar');
  if (progress === null || progress === undefined) {
    bar.style.visibility = 'hidden';
  } else {
    bar.style.visibility = 'visible';
    el('toastBar').style.width = clamp(progress, 0, 100) + '%';
  }
  t.classList.add('on');
}
function updateToast(text, progress) { showToast(text, progress); }
function hideToast() { el('toast').classList.remove('on'); }

function setCamStatus(text, cls) {
  el('camText').textContent = text;
  el('camDot').className = 'dot ' + (cls || '');
}

function setGestureLabel(text, hot) {
  el('gestureText').textContent = text;
  const box = el('roleRBox');
  box.classList.toggle('hot', !!hot);
}

function bindUI() {
  const d = el('density'), tr = el('trail'), gl = el('glow'), hu = el('hue'), st = el('star');

  d.value = P.density;
  el('vDensity').textContent = P.density;
  d.oninput = () => {
    P.density = +d.value;
    el('vDensity').textContent = P.density;
    particles.setCount(Math.round(P.density * S.quality));
    updateRes();
  };

  tr.oninput = () => { P.trail = +tr.value; el('vTrail').textContent = P.trail.toFixed(2); };
  gl.oninput = () => { P.glow = +gl.value; el('vGlow').textContent = P.glow.toFixed(2); };
  hu.oninput = () => {
    P.hue = +hu.value / 360;
    S.hue = P.hue;
    S.hueTarget = P.hue;
    el('vHue').textContent = hu.value;
  };
  st.oninput = () => { P.star = +st.value; el('vStar').textContent = P.star.toFixed(2); };

  el('autoQuality').onchange = (e) => {
    P.autoQuality = e.target.checked;
    if (!P.autoQuality) { S.quality = 1; applyQuality(); }
  };
  el('showPreview').onchange = (e) => {
    P.showPreview = e.target.checked;
    el('preview').classList.toggle('on', P.showPreview && S.mode === 'camera');
  };
  el('autoHue').onchange = (e) => { P.autoHue = e.target.checked; };

  el('btnCam').onclick = () => (S.mode === 'camera' ? stopCamera() : startCamera());
  el('btnDemo').onclick = () => {
    if (S.mode === 'demo') { S.mode = 'idle'; demo.mouse.active = false; el('btnDemo').classList.remove('on'); }
    else startDemo();
  };
  el('btnGif').onclick = () => startGif();
  el('btnFull').onclick = toggleFullscreen;

  el('collapse').onclick = () => {
    const p = el('panel');
    p.classList.toggle('collapsed');
    el('collapse').textContent = p.classList.contains('collapsed') ? '+' : '−';
  };
}

function updateRes() {
  el('resText').textContent = `${renderer.domElement.width}×${renderer.domElement.height}`;
}

function applyQuality() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6) * (0.72 + 0.28 * S.quality);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  particles.setCount(Math.round(P.density * S.quality));
  updateRes();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

/* ------------------------------------------------------------------ *
 *  摄像头 / 演示模式
 * ------------------------------------------------------------------ */
async function startCamera() {
  if (S.mode === 'camera') return;
  try {
    setCamStatus('正在启动摄像头…', 'demo');
    showToast('正在启动摄像头…', null);
    await tracker.start(el('cam'), (msg) => showToast(msg, null));
    S.mode = 'camera';
    demo.mouse.active = false;
    el('btnCam').textContent = '关闭摄像头';
    el('btnCam').classList.add('on');
    el('btnDemo').classList.remove('on');
    el('preview').classList.toggle('on', P.showPreview);
    hideToast();
    setCamStatus(`摄像头运行中 · ${tracker.delegate}`, 'live');
  } catch (err) {
    console.error('[camera]', err);
    showToast('摄像头没能启动：' + (err.message || err) + '\n先看演示模式', null);
    setTimeout(() => { hideToast(); setCamStatus('摄像头未开启', ''); }, 3600);
    setCamStatus('摄像头未开启', '');
    startDemo();
  }
}

function stopCamera() {
  tracker.stop();
  S.mode = 'idle';
  el('btnCam').textContent = '开启摄像头';
  el('btnCam').classList.remove('on');
  el('preview').classList.remove('on');
  setCamStatus('摄像头未开启', '');
}

function startDemo() {
  S.mode = 'demo';
  el('btnDemo').classList.add('on');
  el('btnCam').textContent = '开启摄像头';
  el('btnCam').classList.remove('on');
  el('preview').classList.remove('on');
  if (tracker.running) tracker.stop();
  setCamStatus('演示模式 · 虚拟手势', 'demo');
  hideToast();
}

/* ------------------------------------------------------------------ *
 *  GIF
 * ------------------------------------------------------------------ */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function startGif() {
  if (gif.active || gif.encoding) return;
  gif.start({ seconds: 2.5, fps: 12, maxWidth: 640 });
  showToast('录制中… 0%', 0);
}

async function encodeGif() {
  try {
    updateToast('正在编码 GIF… 0%', 0);
    const blob = await gif.encode((p) => updateToast('正在编码 GIF… ' + Math.round(p * 100) + '%', p * 100));
    if (!blob) { hideToast(); return; }
    downloadBlob(blob, `赛博手势粒子_${stamp()}.gif`);
    if (window.__nebula) {
      window.__nebula.lastGif = { size: blob.size, type: blob.type, frames: gif.lastFrames, w: gif.width, h: gif.height };
    }
    updateToast('已保存 GIF 到下载文件夹', 100);
    setTimeout(hideToast, 1800);
  } catch (e) {
    console.error('[gif]', e);
    updateToast('GIF 导出失败：' + (e.message || e), null);
    setTimeout(hideToast, 3000);
  }
}

/* ------------------------------------------------------------------ *
 *  手势 → 参数
 * ------------------------------------------------------------------ */
function setManual(name, ms = 2600) {
  S.manual = { name, until: performance.now() + ms };
  if (name === 'pinch') doExplode(S.center);
}

function doExplode(point) {
  const wp = palmToWorld(point, new THREE.Vector3());
  particles.explode(wp, 13);
  sparks.burst(wp, 150, S.hue);
  S.shake = 0.55;
  S.explodeCount = (S.explodeCount || 0) + 1;
}

function applyHands(dt, now) {
  const hands = S.hands;
  const L = hands.length ? hands[0] : null;
  const R = hands.length ? hands[hands.length - 1] : null;

  /* 色相：左手横向位置 */
  if (L) {
    S.hueTarget = clamp(L.palm.x, 0.02, 0.98);
  } else if (P.autoHue) {
    S.hueTarget = (S.hueTarget + dt * 0.05) % 1;
  }
  let dh = S.hueTarget - S.hue;
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  S.hue = (S.hue + dh * Math.min(1, dt * 7) + 1) % 1;
  particles.uniforms.uHueShift.value = S.hue;

  /* 辉光：左手高低 */
  S.glowBoost = L ? 0.75 + (1 - L.palm.y) * 0.85 : 1;

  /* 形态中心 + 大小：右手 */
  if (R) {
    palmToWorld(R.palm, S.centerT);
    const spread = R.feat ? R.feat.spread : 1.8;
    S.scaleT = SHAPE_SCALE[S.shape] * clamp(0.85 + (spread - 1.1) * 0.5, 0.85, 1.6);
    S.parallax.x += ((R.palm.x - 0.5) * 2 - S.parallax.x) * Math.min(1, dt * 3);
    S.parallax.y += ((0.5 - R.palm.y) * 1.6 - S.parallax.y) * Math.min(1, dt * 3);
  } else {
    S.centerT.multiplyScalar(1 - Math.min(0.5, dt * 1.2));
    S.centerT.x += Math.sin(now * 0.00028) * dt * 0.5;
    S.centerT.y += Math.cos(now * 0.00035) * dt * 0.35;
    S.scaleT = SHAPE_SCALE[S.shape];
    S.parallax.multiplyScalar(1 - Math.min(0.5, dt * 2));
  }

  S.center.lerp(S.centerT, Math.min(0.55, dt * 8));
  S.scale += (S.scaleT - S.scale) * Math.min(0.5, dt * 5);

  /* 有效手势：手动优先，其次识别结果 */
  let g = null;
  if (S.manual && now < S.manual.until) g = S.manual.name;
  else {
    let hasVictory = false;
    for (const h of hands) {
      if (h.gesture === 'heart') { g = 'heart'; break; }
      if (h.gesture === 'victory') hasVictory = true;
    }
    if (!g && hasVictory) g = 'victory';
  }
  if (!g) g = 'none';
  S.gesture = g;

  /* 形状 */
  if (g === 'heart') { S.shape = 'heart'; S.gestureUntil = now + 700; }
  else if (g === 'victory') { S.shape = 'text'; S.gestureUntil = now + 700; }
  else if (now > S.gestureUntil) S.shape = 'nebula';

  /* 轨迹流光 */
  const active = hands.slice(0, 2);
  for (let i = 0; i < 2; i++) {
    const h = active[i];
    if (h) {
      palmToWorld(h.palm, tmpV);
      trails[i].setHue((S.hue + (i === 0 ? 0 : 0.42)) % 1);
      trails[i].push(tmpV.x, tmpV.y, tmpV.z - 0.4);
    } else {
      trails[i].line.visible = false;
      trails[i].filled = 0;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  HUD
 * ------------------------------------------------------------------ */
let hudT = 0;
function updateHud(now) {
  if (now - hudT < 160) return;
  hudT = now;

  el('fpsText').textContent = Math.round(S.fps) + ' FPS';
  el('countText').textContent = particles.n.toLocaleString('en-US') + ' 粒子';

  const hands = S.hands;
  let gName;
  if (S.gesture !== 'none') gName = GESTURE_CN[S.gesture] || S.gesture;
  else if (S.mode === 'camera' && hands.length === 0) gName = '未检测到手 · 把手放进画面';
  else gName = '等待识别';
  const hot = S.gesture === 'heart' || S.gesture === 'victory' || S.gesture === 'pinch';
  setGestureLabel(gName, hot);

  const roleL = el('roleL'), roleR = el('roleR');
  const boxL = el('roleLBox'), boxR = el('roleRBox');
  if (hands.length >= 2) {
    roleL.textContent = '调色';
    roleR.textContent = '塑形';
    boxL.classList.add('act');
    boxR.classList.add('act');
  } else if (hands.length === 1) {
    roleL.textContent = '调色 + 塑形';
    roleR.textContent = '单手模式';
    boxL.classList.add('act');
    boxR.classList.remove('act');
  } else {
    roleL.textContent = '待机';
    roleR.textContent = '待机';
    boxL.classList.remove('act');
    boxR.classList.remove('act');
  }
}

/* ------------------------------------------------------------------ *
 *  主循环
 * ------------------------------------------------------------------ */
let last = performance.now();
let time = 0;
let fpsSmooth = 60;

function frame(now) {
  requestAnimationFrame(frame);

  const dtRaw = (now - last) / 1000;
  last = now;
  const dt = clamp(dtRaw, 0.001, 0.05);
  time += dt;

  /* 1. 手 */
  let rawHands = [];
  if (S.mode === 'camera') rawHands = tracker.detect(now);
  else if (S.mode === 'demo') rawHands = demo.update(dt);

  engine.update(rawHands, now);
  S.hands = engine.hands;

  /* 2. 参数 */
  applyHands(dt, now);

  for (const ev of engine.events) {
    if (ev.type === 'pinch') doExplode(ev.point);
  }

  /* 3. 粒子 */
  const params = {
    stiffness: 26,
    damping: 0.9,
    swirl: 1.5,
    trail: P.trail,
    glow: P.glow * S.glowBoost,
    pixelRatio,
    stagger: 1,
  };
  const base = shapeCache[S.shape] || shapeCache.nebula;
  particles.setShape(base, S.center, S.scale, 1, S.shape);
  particles.update(dt, time, params);

  if (S.shape === 'heart') {
    sparks.heartStream(dt, S.center, S.scale * 0.95, S.hue);
  }
  sparks.update(dt, S.hue);
  sparks.uniforms.uPixelRatio.value = pixelRatio;

  /* 4. 星空 / 镜头 */
  stars.update(dt, S.parallax, P.star);
  S.shake *= Math.pow(0.02, dt);
  camera.position.x = Math.sin(time * 47) * S.shake * 0.5;
  camera.position.y = Math.cos(time * 53) * S.shake * 0.4;
  camera.position.z = 16 - S.shake * 0.6;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);

  /* 5. 预览 + GIF 抓帧 */
  if (S.mode === 'camera' && P.showPreview) {
    overlay.visible = true;
    overlay.draw(el('cam'), S.hands, S.gesture === 'none' ? '' : GESTURE_CN[S.gesture]);
  }
  if (gif.active) {
    const done = gif.capture(renderer.domElement);
    updateToast('录制中… ' + Math.round(gif.progress * 100) + '%', gif.progress * 100);
    if (done) encodeGif();
  }

  /* 6. 性能 */
  fpsSmooth = fpsSmooth * 0.9 + (1 / dtRaw) * 0.1;
  S.fps = fpsSmooth;
  if (P.autoQuality && now - S.lastQuality > 2400) {
    if (fpsSmooth < 42 && S.quality > 0.5) {
      S.quality = Math.max(0.5, S.quality - 0.12);
      applyQuality();
      S.lastQuality = now;
    } else if (fpsSmooth > 57 && S.quality < 1) {
      S.quality = Math.min(1, S.quality + 0.07);
      applyQuality();
      S.lastQuality = now;
    }
  }

  updateHud(now);

  if (!S.booted) {
    S.booted = true;
    const boot = el('boot');
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 900);
    updateRes();
    particles.setCount(Math.round(P.density * S.quality));
  }
}

/* ------------------------------------------------------------------ *
 *  事件
 * ------------------------------------------------------------------ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  updateView();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  updateRes();
});

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
    if (e.code === 'Space') e.target.blur();
    else return;
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      doExplode(S.center);
      break;
    case 'Digit1': setManual('heart'); break;
    case 'Digit2': setManual('victory'); break;
    case 'Digit3': setManual('pinch'); break;
    case 'Digit0': S.manual = null; break;
    case 'Tab':
      e.preventDefault();
      document.body.classList.toggle('clean');
      break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyG': startGif(); break;
    case 'KeyC': S.mode === 'camera' ? stopCamera() : startCamera(); break;
    case 'KeyD': S.mode === 'demo' ? (S.mode = 'idle') : startDemo(); break;
    default: break;
  }
});

window.addEventListener('pointermove', (e) => {
  if (S.mode !== 'demo') return;
  demo.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
});

/* ------------------------------------------------------------------ *
 *  启动
 * ------------------------------------------------------------------ */
bindUI();
particles.setCount(P.density);
particles.uniforms.uHueShift.value = P.hue;

if (qs.get('ui') === '0') document.body.classList.add('clean');
if (qs.get('demo') === '1') startDemo();
else if (qs.get('cam') === '1') setTimeout(startCamera, 400);

setTimeout(() => { el('tips').style.opacity = '0'; }, 12000);

/* 调试钩子：?debug=1 时暴露内部状态，方便排查（不影响正常使用） */
if (qs.get('debug') === '1') {
  window.__nebula = {
    S, P, particles, sparks, engine, tracker, stars, renderer, scene, camera, gif, demo, shapeCache,
    errors: [],
    stats() {
      const gl = renderer.getContext();
      const W = renderer.domElement.width, H = renderer.domElement.height;
      const buf = new Uint8Array(W * H * 4);
      renderer.render(scene, camera);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let lit = 0, sum = 0, maxc = 0, rs = 0, gs = 0, bs = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        const v = (r + g + b) / 3;
        sum += v; rs += r; gs += g; bs += b;
        if (v > 18) lit++;
        if (v > maxc) maxc = v;
      }
      const px = W * H;
      return {
        w: W, h: H,
        lit: +(lit / px).toFixed(4),
        avg: +(sum / px).toFixed(2),
        max: maxc,
        r: +(rs / px).toFixed(2),
        g: +(gs / px).toFixed(2),
        b: +(bs / px).toFixed(2),
        hue: +S.hue.toFixed(3),
        shape: S.shape,
        gesture: S.gesture,
        mode: S.mode,
        hands: S.hands.length,
        particles: particles.n,
        fps: +S.fps.toFixed(1),
      };
    },
  };
  window.addEventListener('error', (e) => window.__nebula.errors.push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => window.__nebula.errors.push('promise: ' + String(e.reason)));
}

requestAnimationFrame(frame);
