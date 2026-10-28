/* 演示模式：没有摄像头（或展会现场不想开摄像头）时，用虚拟双手驱动 */

const PRESETS = {
  none:    { open: [1, 1, 1, 0], pinch: 0.95, spread: 1.95 },
  victory: { open: [1, 1, 0, 0], pinch: 0.85, spread: 1.62 },
  heart:   { open: [0, 0, 0, 0], pinch: 0.24, spread: 1.10 },
  pinch:   { open: [1, 1, 1, 1], pinch: 0.20, spread: 1.92 },
  fist:    { open: [0, 0, 0, 0], pinch: 1.28, spread: 1.02 },
  palm:    { open: [1, 1, 1, 1], pinch: 1.10, spread: 2.35 },
};

const CYCLE = ['none', 'victory', 'heart', 'pinch', 'palm', 'none', 'pinch'];

function makeFeat(name) {
  const p = PRESETS[name] || PRESETS.none;
  return {
    ext: {
      thumb: p.open[0] === 1,
      index: p.open[0] === 1,
      middle: p.open[1] === 1,
      ring: p.open[2] === 1,
      pinky: p.open[3] === 1,
    },
    pinch: p.pinch,
    spread: p.spread,
    scale: 0.16,
    palm: { x: 0.5, y: 0.5, z: 0 },
  };
}

export class DemoHands {
  constructor(opts = {}) {
    this.t = 0;
    this.fixed = opts.gesture || null;     // 固定某个手势（用于截图/调试）
    this.cycle = this.fixed ? null : CYCLE;
    this.step = 0;
    this.stepT = 0;
    this.mouse = { x: 0.5, y: 0.5, active: false };
    this.pinchPhase = 0;
  }

  setGesture(name) {
    this.fixed = name;
    this.cycle = null;
  }

  setMouse(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.active = true;
  }

  /* 返回两只虚拟手（结构与 tracker 输出一致，直接给 feat） */
  update(dt) {
    this.t += dt;
    this.stepT += dt;

    let g;
    if (this.fixed) {
      if (this.fixed === 'pinch') {
        // 捏合需要“开→合”的动作才触发爆炸，这里做节律
        this.pinchPhase += dt;
        g = this.pinchPhase % 2.4 < 1.2 ? 'pinch' : 'none';
      } else {
        g = this.fixed;
      }
    } else {
      if (this.stepT > 2.6) { this.stepT = 0; this.step = (this.step + 1) % this.cycle.length; }
      g = this.cycle[this.step];
    }

    const t = this.t;
    const hands = [];

    // 左手：在屏幕左侧缓慢画 8 字
    const lx = 0.30 + Math.sin(t * 0.55) * 0.11;
    const ly = 0.52 + Math.sin(t * 0.85 + 1.2) * 0.10;
    const featL = makeFeat('none');
    featL.palm = { x: lx, y: ly, z: 0 };
    hands.push({ key: 'demoL', demo: true, label: 'Left', feat: featL, palm: featL.palm });

    // 右手：鼠标可接管位置，否则自己飘
    let rx = 0.68 + Math.cos(t * 0.47) * 0.09;
    let ry = 0.48 + Math.cos(t * 0.71) * 0.09;
    if (this.mouse.active) {
      rx += (this.mouse.x - rx) * Math.min(1, dt * 5);
      ry += (this.mouse.y - ry) * Math.min(1, dt * 5);
    }
    const featR = makeFeat(g);
    featR.palm = { x: rx, y: ry, z: 0 };
    hands.push({ key: 'demoR', demo: true, label: 'Right', feat: featR, palm: featR.palm });

    return hands;
  }
}
