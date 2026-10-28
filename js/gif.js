import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc/gifenc.esm.js';

/* 录屏 → GIF：从 canvas 抓帧，用 gifenc 在浏览器里直接编码，不依赖任何服务端 */
export class GifRecorder {
  constructor() {
    this.active = false;
    this.encoding = false;
    this.frames = [];
    this.width = 640;
    this.height = 360;
    this.fps = 12;
    this.targetFrames = 0;
    this._cv = document.createElement('canvas');
    this._ctx = this._cv.getContext('2d', { willReadFrequently: true });
    this._lastGrab = 0;
  }

  get progress() {
    if (!this.targetFrames) return 0;
    return Math.min(1, this.frames.length / this.targetFrames);
  }

  start({ seconds = 3, fps = 12, maxWidth = 640 } = {}) {
    if (this.active || this.encoding) return false;
    this.fps = fps;
    this.targetFrames = Math.round(seconds * fps);
    this.frames = [];
    this.active = true;
    this._lastGrab = 0;
    this.maxWidth = maxWidth;
    return true;
  }

  /* 必须在 render 之后同一帧里调用 */
  capture(source) {
    if (!this.active) return false;
    const now = performance.now();
    const interval = 1000 / this.fps;
    if (now - this._lastGrab < interval * 0.9) return false;
    this._lastGrab = now;

    if (this.frames.length === 0) {
      const aspect = source.height / source.width;
      this.width = Math.min(this.maxWidth, source.width) & ~1;
      this.height = Math.round(this.width * aspect) & ~1;
      this._cv.width = this.width;
      this._cv.height = this.height;
    }
    const ctx = this._ctx;
    ctx.drawImage(source, 0, 0, this.width, this.height);
    const img = ctx.getImageData(0, 0, this.width, this.height);
    this.frames.push(new Uint8Array(img.data.buffer.slice(0)));

    if (this.frames.length >= this.targetFrames) {
      this.active = false;
      return true;
    }
    return false;
  }

  async encode(onProgress = () => {}) {
    if (this.encoding || !this.frames.length) return null;
    this.encoding = true;
    const gif = GIFEncoder();
    const delay = Math.round(1000 / this.fps);
    const total = this.frames.length;

    for (let i = 0; i < total; i++) {
      const data = this.frames[i];
      const palette = quantize(data, 256, { format: 'rgb444' });
      const index = applyPalette(data, palette, 'rgb444');
      gif.writeFrame(index, this.width, this.height, {
        palette,
        delay,
        repeat: 0,
        transparent: false,
      });
      if (i % 2 === 0) {
        onProgress(i / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    gif.finish();
    const bytes = gif.bytes();
    this.lastFrames = total;
    this.frames = [];
    this.encoding = false;
    onProgress(1);
    return new Blob([bytes], { type: 'image/gif' });
  }

  abort() {
    this.active = false;
    this.frames = [];
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
