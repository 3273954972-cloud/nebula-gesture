/* 手势特征 + 双手职责分配（纯几何，不依赖具体引擎） */

export const GESTURE_CN = {
  victory: '比耶 ✌',
  heart: '比心 🫶',
  pinch: '捏合 🤏',
  palm: '张开 🖐',
  fist: '握拳 ✊',
  none: '—',
};

const d2 = (a, b, wz = 0.35) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z - b.z) * wz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/* 原始 landmark（未镜像）→ 用户视角坐标（镜像后）*/
export function toUserSpace(landmarks) {
  const out = new Array(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    out[i] = { x: 1 - p.x, y: p.y, z: p.z };
  }
  return out;
}

export function features(lm) {
  const scale = Math.max(0.02, d2(lm[0], lm[9]));
  const wrist = lm[0];
  const ext = {
    thumb: d2(lm[4], lm[17]) / scale > 0.95,
    index: d2(lm[8], wrist) > d2(lm[6], wrist) * 1.12,
    middle: d2(lm[12], wrist) > d2(lm[10], wrist) * 1.12,
    ring: d2(lm[16], wrist) > d2(lm[14], wrist) * 1.12,
    pinky: d2(lm[20], wrist) > d2(lm[18], wrist) * 1.12,
  };
  const pinch = d2(lm[4], lm[8]) / scale;
  const tips = [lm[8], lm[12], lm[16], lm[20]];
  const palm = lm[9];
  let spread = 0;
  for (const t of tips) spread += d2(t, palm) / scale;
  spread /= 4;
  const palmPt = {
    x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
    y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
    z: (lm[0].z + lm[5].z + lm[9].z + lm[13].z + lm[17].z) / 5,
  };
  return { ext, pinch, spread, palm: palmPt, scale };
}

export function classify(f) {
  const e = f.ext;
  const openCount = (e.index ? 1 : 0) + (e.middle ? 1 : 0) + (e.ring ? 1 : 0) + (e.pinky ? 1 : 0);

  // 比耶：食指 + 中指伸出，无名指小指收
  if (e.index && e.middle && !e.ring && !e.pinky) return 'victory';

  // 捏合：拇指食指相碰，其余三指是张开的（“捏”的姿势）
  if (f.pinch < 0.46 && e.middle && openCount >= 3) return 'pinch';

  // 比心：拇指食指相碰，其余手指全收（指尖比心）
  if (f.pinch < 0.5 && !e.middle && !e.ring && !e.pinky) return 'heart';

  if (openCount === 4) return 'palm';
  if (openCount === 0 && f.pinch > 0.75) return 'fist';
  return null;
}

const STABLE_FRAMES = 4;
const PINCH_COOLDOWN = 1100;

export class GestureEngine {
  constructor() {
    this.hands = [];       // 归一化后的手 [{side, palm, feat, gesture, ...}]
    this.events = [];
    this.tracked = new Map(); // id -> {pending, count, active, lastPinch}
    this._nextId = 1;
  }

  /**
   * @param raw [{ key, landmarks, label, feat, palm, demo }]
   */
  update(raw, now) {
    this.events.length = 0;
    const hands = [];

    for (const h of raw) {
      let feat = h.feat;
      let palm = h.palm;
      let lm = null;

      if (!feat && h.landmarks) {
        lm = toUserSpace(h.landmarks);
        feat = features(lm);
        palm = feat.palm;
      }
      if (!feat) continue;

      const id = h.key || 'h' + this._nextId;
      let st = this.tracked.get(id);
      if (!st) {
        st = { pending: null, count: 0, active: null, lastPinch: -1e9 };
        this.tracked.set(id, st);
      }

      const g = classify(feat) || 'none';
      if (g === st.pending) st.count++;
      else { st.pending = g; st.count = 1; }

      if (st.count >= STABLE_FRAMES && st.active !== st.pending) {
        st.active = st.pending;
        this.events.push({ type: 'gesture', gesture: st.active, side: h.side || null, id });
        if (st.active === 'pinch' && now - st.lastPinch > PINCH_COOLDOWN) {
          st.lastPinch = now;
          this.events.push({ type: 'pinch', id, point: palm, side: h.side || null });
        }
      }

      hands.push({
        id,
        label: h.label || '',
        side: h.side || null,
        demo: !!h.demo,
        landmarks: lm,
        feat,
        palm,
        gesture: st.active || 'none',
        raw: h.gesture || null,
      });
    }

    // 清理消失的手
    if (this.tracked.size > hands.length + 4) {
      const alive = new Set(hands.map(h => h.id));
      for (const k of [...this.tracked.keys()]) if (!alive.has(k)) this.tracked.delete(k);
    }

    hands.sort((a, b) => a.palm.x - b.palm.x);
    for (let i = 0; i < hands.length; i++) {
      hands[i].side = hands.length > 1 ? (i === 0 ? 'L' : 'R') : null;
    }
    this.hands = hands;
    return this;
  }

  get leftHand() { return this.hands[0] || null; }
  get rightHand() { return this.hands[this.hands.length - 1] || null; }
}
