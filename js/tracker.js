/* MediaPipe HandLandmarker 封装：本地模型 + 本地 wasm，完全离线 */

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.ready = false;
    this.running = false;
    this.busy = false;
    this.lastTs = 0;
    this.lastDetect = 0;
    this.hands = [];
    this.delegate = '—';
    this.fps = 0;
    this._frames = 0;
    this._t0 = 0;
  }

  async loadModel(onStatus = () => {}) {
    if (this.landmarker) return;
    onStatus('正在加载手势模型…');
    const mod = await import('../vendor/tasks-vision/vision_bundle.mjs');
    const { FilesetResolver, HandLandmarker } = mod;
    const fileset = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');

    const opts = (delegate) => ({
      baseOptions: {
        modelAssetPath: './models/hand_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('[hand] GPU 初始化失败，回退 CPU', err);
      onStatus('显卡加速不可用，改用 CPU 模式…');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.delegate = 'CPU';
    }
    this.ready = true;
  }

  async start(video, onStatus = () => {}) {
    if (this.running) return true;
    this.video = video;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('浏览器不支持摄像头（需要 https 或 localhost）');
    }
    onStatus('正在请求摄像头权限…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    await new Promise((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
      setTimeout(resolve, 2500);
    });

    await this.loadModel(onStatus);
    this.running = true;
    this._t0 = performance.now();
    this._frames = 0;
    onStatus('手势识别已启动');
    return true;
  }

  stop() {
    this.running = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.hands = [];
  }

  /* 每帧调用；内部做 30fps 节流 */
  detect(now) {
    if (!this.running || !this.landmarker || !this.video) return this.hands;
    if (this.video.readyState < 2) return this.hands;
    if (now - this.lastDetect < 28) return this.hands;

    this.lastDetect = now;
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;

    let res;
    try {
      res = this.landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      console.warn('[hand] detect 失败', err);
      return this.hands;
    }

    const lmArr = res?.landmarks || [];
    const handed = res?.handednesses || res?.handedness || [];
    const out = [];
    for (let i = 0; i < lmArr.length; i++) {
      const lm = lmArr[i];
      if (!lm || lm.length < 21) continue;
      out.push({
        key: 'h' + i,
        label: handed?.[i]?.[0]?.categoryName || '',
        score: handed?.[i]?.[0]?.score || 0,
        landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 })),
      });
    }
    this.hands = out;

    this._frames++;
    if (now - this._t0 > 1000) {
      this.fps = Math.round((this._frames * 1000) / (now - this._t0));
      this._frames = 0;
      this._t0 = now;
    }
    return out;
  }
}
