/* 摄像头预览 + 手部骨架叠加（用户视角，镜像显示） */

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const TIPS = [4, 8, 12, 16, 20];

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = true;
  }

  clear() {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(video, hands, gestureText = '') {
    const cv = this.canvas;
    const ctx = this.ctx;
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    if (!this.visible) return;

    if (video && video.readyState >= 2 && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale, dh = vh * scale;
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
      ctx.fillStyle = 'rgba(3, 8, 16, 0.28)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = 'rgba(6, 12, 22, 0.85)';
      ctx.fillRect(0, 0, w, h);
    }

    for (const hand of hands || []) {
      const lm = hand.landmarks;
      if (!lm) continue;
      const col = hand.side === 'L' ? '53,240,255' : hand.side === 'R' ? '255,61,240' : '190,220,255';
      const px = (p) => p.x * w;
      const py = (p) => p.y * h;

      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(${col},0.9)`;
      ctx.shadowColor = `rgba(${col},0.9)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        if (!lm[a] || !lm[b]) continue;
        ctx.moveTo(px(lm[a]), py(lm[a]));
        ctx.lineTo(px(lm[b]), py(lm[b]));
      }
      ctx.stroke();

      ctx.shadowBlur = 10;
      for (let i = 0; i < lm.length; i++) {
        const isTip = TIPS.includes(i);
        ctx.beginPath();
        ctx.fillStyle = isTip ? `rgba(${col},1)` : `rgba(${col},0.55)`;
        ctx.arc(px(lm[i]), py(lm[i]), isTip ? 3 : 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    if (gestureText) {
      ctx.font = '600 11px Consolas, monospace';
      ctx.fillStyle = 'rgba(220,245,255,0.85)';
      ctx.fillText(gestureText, 8, h - 8);
    }
  }
}
