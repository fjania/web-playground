import { PALETTES } from './palettes.js';
import { STOP_WORDS } from './datasets.js';

export class WordCloud {
  static PALETTES = PALETTES;

  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      fontFamily: 'DM Sans, sans-serif',
      minFontSize: 12,
      maxFontSize: null,
      scaling: 'sqrt',
      colorScheme: 'vibrant',
      rotationProbability: 0.3,
      padding: 4,
      dynamicSpacing: false,
      maxWords: 300,
      backgroundColor: '#1a1a2e',
      ...options,
    };

    this._listeners = {};
    this._placedWords = [];
    this._worker = null;
    this._animationFrame = null;
    this._zoom = { scale: 1, tx: 0, ty: 0 };

    this._setupCanvas();
  }

  _setupCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._resize();

    this._resizeObserver = new ResizeObserver(() => {
      this._resize();
      if (this._placedWords.length > 0) {
        this._computeZoom();
        this._redrawAll();
      }
    });
    this._resizeObserver.observe(this.container);

    this.canvas.addEventListener('click', (e) => this._handleClick(e));
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._width = rect.width;
    this._height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _createWorker() {
    return new Worker('./layout-worker.js');
  }

  async render(words) {
    this.clear();
    if (!words || words.length === 0) return;

    // Load the specific font before measuring — document.fonts.ready is
    // insufficient because it resolves immediately if no downloads are pending,
    // even when the selected font hasn't been triggered yet.
    await Promise.all([
      document.fonts.load(`400 48px ${this.options.fontFamily}`),
      document.fonts.load(`700 48px ${this.options.fontFamily}`),
    ]);

    words = words
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, this.options.maxWords);

    const palette = this._getPalette();
    const maxFontSize = this.options.maxFontSize || Math.round(this._height * 0.18);
    const { minFontSize, scaling, rotationProbability, padding, fontFamily, dynamicSpacing } = this.options;
    const maxValue = words[0].value;
    const sprites = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const norm = w.value / maxValue;
      let scaled;
      if (scaling === 'log') {
        scaled = Math.log(w.value + 1) / Math.log(maxValue + 1);
      } else if (scaling === 'linear') {
        scaled = norm;
      } else {
        scaled = Math.sqrt(norm);
      }
      const fontSize = Math.round(minFontSize + (maxFontSize - minFontSize) * scaled);
      const rotation = (i === 0) ? 0
        : (Math.random() < rotationProbability
          ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
          : 0);
      const color = typeof palette === 'function' ? palette(w, i) : palette[i % palette.length];

      // Dynamic spacing: scale padding proportionally with font size
      const effectivePadding = dynamicSpacing
        ? Math.round(padding * (0.3 + 0.7 * fontSize / maxFontSize))
        : padding;

      const sprite = this._rasterizeWord(w.text, fontSize, fontFamily, rotation, effectivePadding);
      if (sprite) {
        sprites.push({ ...sprite, text: w.text, fontSize, rotation, color });
      }
    }

    this._worker = this._createWorker();
    this._worker.onmessage = (e) => this._handleWorkerMessage(e);
    this._worker.onerror = (e) => console.error('Layout worker error:', e);

    this._worker.postMessage({
      cmd: 'start',
      sprites,
      config: { width: this._width, height: this._height, layout: this.options.layout || 'spiral' },
    });

    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, this._width, this._height);
  }

  _rasterizeWord(text, fontSize, fontFamily, rotation, padding) {
    const font = `${fontSize}px ${fontFamily}`;

    const probe = new OffscreenCanvas(fontSize * text.length + padding * 4, fontSize * 3 + padding * 4);
    const pctx = probe.getContext('2d');
    pctx.font = font;
    pctx.textBaseline = 'alphabetic';
    const metrics = pctx.measureText(text);

    const textW = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
    const textH = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
    if (textW <= 0 || textH <= 0) return null;

    const natW = textW + padding * 4;
    const natH = textH + padding * 4;
    const natTextX = metrics.actualBoundingBoxLeft + padding * 2;
    const natTextY = metrics.actualBoundingBoxAscent + padding * 2;

    const spriteW = rotation !== 0 ? natH : natW;
    const spriteH = rotation !== 0 ? natW : natH;

    const canvas = new OffscreenCanvas(spriteW, spriteH);
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';

    let textX, textY;
    if (rotation !== 0) {
      ctx.translate(spriteW / 2, spriteH / 2);
      ctx.rotate(rotation);
      textX = -natW / 2 + natTextX;
      textY = -natH / 2 + natTextY;
    } else {
      textX = natTextX;
      textY = natTextY;
    }

    if (padding > 0) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = padding * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, textX, textY);
    }
    ctx.fillStyle = '#000';
    ctx.fillText(text, textX, textY);

    const imageData = ctx.getImageData(0, 0, spriteW, spriteH);
    const pixels = imageData.data;
    const w32 = Math.ceil(spriteW / 32);
    const packed = new Uint32Array(w32 * spriteH);

    for (let y = 0; y < spriteH; y++) {
      for (let x = 0; x < spriteW; x++) {
        if (pixels[(y * spriteW + x) * 4 + 3] > 32) {
          packed[y * w32 + (x >> 5)] |= 1 << (31 - (x & 31));
        }
      }
    }

    return { data: packed, w: spriteW, h: spriteH, w32, textX, textY };
  }

  clear() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
    this._placedWords = [];
    this._zoom = { scale: 1, tx: 0, ty: 0 };

    if (this.ctx) {
      this.ctx.fillStyle = this.options.backgroundColor;
      this.ctx.fillRect(0, 0, this._width, this._height);
    }
  }

  destroy() {
    this.clear();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.canvas.remove();
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
  }

  _emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach((cb) => cb(data));
    }
  }

  _getPalette() {
    const scheme = this.options.colorScheme;
    if (typeof scheme === 'function') return scheme;
    return PALETTES[scheme] || PALETTES.vibrant;
  }

  _handleWorkerMessage(e) {
    const { cmd } = e.data;
    if (cmd === 'wordPlaced') {
      this._placedWords.push(e.data.word);
      this._emit('wordPlaced', { word: e.data.word, progress: e.data.progress });
    } else if (cmd === 'complete') {
      this._debugOrigins = e.data.debugOrigins || [];
      this._computeZoom();
      if (this.options.layout === 'tetris') {
        this._animateTetris();
      } else {
        this._animateReveal();
      }
      this._emit('complete', e.data);
    }
  }

  _computeZoom() {
    const words = this._placedWords;
    if (words.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of words) {
      minX = Math.min(minX, w.x);
      minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x + w.spriteW);
      maxY = Math.max(maxY, w.y + w.spriteH);
    }

    const cloudW = maxX - minX;
    const cloudH = maxY - minY;
    if (cloudW <= 0 || cloudH <= 0) return;

    const margin = 0.05;
    const availW = this._width * (1 - margin * 2);
    const availH = this._height * (1 - margin * 2);
    const scale = Math.min(availW / cloudW, availH / cloudH);

    const cloudCX = this._width / 2 + (minX + maxX) / 2;
    const cloudCY = this._height / 2 + (minY + maxY) / 2;

    if (this.options.layout === 'tetris') {
      // Bottom-align: pin the cloud's bottom edge to the canvas bottom
      const cloudBottom = this._height / 2 + maxY;
      this._zoom = {
        scale,
        tx: this._width / 2 - cloudCX * scale,
        ty: this._height * (1 - margin) - cloudBottom * scale,
      };
    } else {
      this._zoom = {
        scale,
        tx: this._width / 2 - cloudCX * scale,
        ty: this._height / 2 - cloudCY * scale,
      };
    }
  }

  _animateReveal() {
    const words = this._placedWords;
    if (words.length === 0) return;

    let revealed = 0;
    const totalDuration = Math.min(400, words.length * 8);
    const interval = totalDuration / words.length;

    const step = () => {
      const now = performance.now();
      const targetCount = Math.min(words.length, Math.floor((now - startTime) / interval) + 1);

      if (revealed < targetCount) {
        this.ctx.fillStyle = this.options.backgroundColor;
        this.ctx.fillRect(0, 0, this._width, this._height);
        this._drawDebugOrigins();
        revealed = targetCount;
        for (let i = 0; i < revealed; i++) {
          this._drawWord(words[i]);
        }
      }

      if (revealed < words.length) {
        this._animationFrame = requestAnimationFrame(step);
      }
    };

    const startTime = performance.now();
    this._animationFrame = requestAnimationFrame(step);
  }

  _animateTetris() {
    const words = this._placedWords;
    if (words.length === 0) return;

    const z = this._zoom;

    // The clock: gravity is the metronome
    const GRAVITY_INTERVAL = 180; // ms between each drop step
    const DROP_STEP = 40;         // pixels per gravity tick (fixed for all words)

    // The player: acts faster than gravity
    const H_STEP = 30;            // pixels per lateral move
    const PLAYER_MOVE_DELAY = 30; // ms between lateral moves
    const ROT_STEP_DELAY = 120;   // ms per 90° rotation step

    // Transitions
    const LOCK_DELAY = 100;       // ms pause after landing
    const ENTRY_DELAY = 50;       // ms before next piece spawns

    // Spawn position in layout space
    const spawnY = (-z.ty / z.scale) - 40;
    const spawnX = (this._width / 2 - z.tx) / z.scale;

    // Pre-compute per-word info
    const pieces = words.map((word) => {
      const finalX = this._width / 2 + word.x;
      const finalY = this._height / 2 + word.y;

      // How many lateral moves to reach final X
      const hDist = finalX - spawnX;
      const hMoves = Math.abs(hDist) < 1 ? 0 : Math.max(1, Math.round(Math.abs(hDist) / H_STEP));
      const hDir = hDist >= 0 ? 1 : -1;
      const hPerMove = hMoves > 0 ? hDist / hMoves : 0;

      // How many gravity rows to reach final Y
      const totalRows = Math.max(1, Math.round((finalY - spawnY) / DROP_STEP));

      // Rotation: trigger at a random row 10-60% through the fall
      const rotTriggerRow = word.rotation !== 0
        ? Math.floor(totalRows * (0.1 + Math.random() * 0.5))
        : -1;

      return { finalX, finalY, hMoves, hPerMove, totalRows, rotTriggerRow };
    });

    // Active piece state
    let idx = 0;
    let phase = 'falling'; // falling | locking | entry | done

    let row = 0;                // current gravity row
    let lastGravityTime = 0;    // last time gravity ticked
    let hMovesDone = 0;         // lateral moves completed
    let lastPlayerMoveTime = 0; // last time player moved laterally
    let rotStartTime = 0;       // when rotation started
    let rotStarted = false;     // whether rotation has been triggered
    let phaseTime = 0;          // timestamp for lock/entry phases

    function initPiece(t) {
      row = 0;
      hMovesDone = 0;
      lastGravityTime = t;
      lastPlayerMoveTime = t;
      rotStarted = false;
      rotStartTime = 0;
      phase = 'falling';
    }

    const tick = () => {
      const now = performance.now();
      const t = now - startTime;
      const piece = pieces[idx];
      const word = words[idx];

      if (phase === 'falling') {
        // --- GRAVITY: the clock ticks ---
        while (row < piece.totalRows && t - lastGravityTime >= GRAVITY_INTERVAL) {
          row++;
          lastGravityTime += GRAVITY_INTERVAL;
        }

        // --- PLAYER: moves between gravity ticks ---
        // Lateral
        while (hMovesDone < piece.hMoves && t - lastPlayerMoveTime >= PLAYER_MOVE_DELAY) {
          hMovesDone++;
          lastPlayerMoveTime += PLAYER_MOVE_DELAY;
        }

        // Rotation: triggered at a specific row, then takes ROT_STEP_DELAY to snap
        if (!rotStarted && piece.rotTriggerRow >= 0 && row >= piece.rotTriggerRow) {
          rotStarted = true;
          rotStartTime = t;
        }

        // --- LANDING: gravity delivered the piece ---
        if (row >= piece.totalRows) {
          phase = 'locking';
          phaseTime = t;
        }
      }

      if (phase === 'locking' && t - phaseTime >= LOCK_DELAY) {
        phase = 'entry';
        phaseTime = t;
      }

      if (phase === 'entry' && t - phaseTime >= ENTRY_DELAY) {
        idx++;
        if (idx < words.length) {
          initPiece(t);
        } else {
          phase = 'done';
        }
      }

      // --- DRAW ---
      this.ctx.fillStyle = this.options.backgroundColor;
      this.ctx.fillRect(0, 0, this._width, this._height);

      // Landed words
      const landedTo = (phase === 'locking' || phase === 'entry' || phase === 'done')
        ? idx + 1 : idx;
      for (let i = 0; i < Math.min(landedTo, words.length); i++) {
        this._drawWord(words[i]);
      }

      // Active piece in flight
      if (phase === 'falling') {
        // Y from gravity (steady pulse)
        const curY = Math.min(piece.finalY, spawnY + row * DROP_STEP);

        // X from player (fast moves between gravity ticks)
        const curX = hMovesDone >= piece.hMoves
          ? piece.finalX
          : spawnX + hMovesDone * piece.hPerMove;

        // Rotation from player
        let curRot = 0;
        if (rotStarted) {
          const rotElapsed = t - rotStartTime;
          const stepsCompleted = Math.floor(rotElapsed / ROT_STEP_DELAY);
          const dir = word.rotation > 0 ? 1 : -1;
          const stepsNeeded = 1; // always one 90° step for ±PI/2
          curRot = stepsCompleted >= stepsNeeded ? word.rotation : 0;
        }

        this._drawWordInLayout(word, curX, curY, curRot);
      }

      // NEXT preview
      if (idx + 1 < words.length) {
        this._drawNextPreview(words[idx + 1]);
      }

      if (phase !== 'done') {
        this._animationFrame = requestAnimationFrame(tick);
      }
    };

    const startTime = performance.now();
    initPiece(0);
    this._animationFrame = requestAnimationFrame(tick);
  }

  _drawWordInLayout(word, layoutX, layoutY, rotation) {
    // Draw a word at arbitrary layout-space coords with zoom transform
    // (same transform as _drawWord, but with custom position)
    const ctx = this.ctx;
    const z = this._zoom;

    ctx.save();
    ctx.translate(z.tx, z.ty);
    ctx.scale(z.scale, z.scale);

    ctx.font = `${word.fontSize}px ${this.options.fontFamily}`;
    ctx.fillStyle = word.color;
    ctx.textBaseline = 'alphabetic';

    if (rotation !== 0) {
      ctx.translate(layoutX + word.spriteW / 2, layoutY + word.spriteH / 2);
      ctx.rotate(rotation);
      ctx.fillText(word.text, word.textX, word.textY);
    } else {
      ctx.fillText(word.text, layoutX + word.textX, layoutY + word.textY);
    }

    ctx.restore();
  }

  _drawNextPreview(word) {
    const ctx = this.ctx;
    const x = this._width - 20;
    const y = 28;

    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    // "NEXT" label
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(136, 136, 170, 0.6)';
    ctx.fillText('NEXT', x, y);

    // Word preview
    const previewSize = Math.min(16, word.fontSize);
    ctx.font = `${previewSize}px ${this.options.fontFamily}`;
    ctx.fillStyle = word.color;
    ctx.globalAlpha = 0.7;
    ctx.fillText(word.text, x, y + 18);

    ctx.restore();
  }

  _drawWord(word) {
    const ctx = this.ctx;
    const z = this._zoom;

    ctx.save();
    ctx.translate(z.tx, z.ty);
    ctx.scale(z.scale, z.scale);

    const sx = this._width / 2 + word.x;
    const sy = this._height / 2 + word.y;

    ctx.font = `${word.fontSize}px ${this.options.fontFamily}`;
    ctx.fillStyle = word.color;
    ctx.textBaseline = 'alphabetic';

    if (word.rotation !== 0) {
      ctx.translate(sx + word.spriteW / 2, sy + word.spriteH / 2);
      ctx.rotate(word.rotation);
      ctx.fillText(word.text, word.textX, word.textY);
    } else {
      ctx.fillText(word.text, sx + word.textX, sy + word.textY);
    }

    ctx.restore();
  }

  _redrawAll() {
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, this._width, this._height);
    this._drawDebugOrigins();
    for (const word of this._placedWords) {
      this._drawWord(word);
    }
  }

  _drawDebugOrigins() {
    if (!this.options.showDebugPath) return;
    const origins = this._debugOrigins;
    if (!origins || origins.length < 2) return;

    const ctx = this.ctx;
    const z = this._zoom;
    ctx.save();
    ctx.translate(z.tx, z.ty);
    ctx.scale(z.scale, z.scale);

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(83, 216, 251, 0.3)';
    ctx.lineWidth = 1.5 / z.scale;
    for (let i = 0; i < origins.length; i++) {
      const px = this._width / 2 + origins[i].x;
      const py = this._height / 2 + origins[i].y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    for (let i = 0; i < origins.length; i++) {
      const px = this._width / 2 + origins[i].x;
      const py = this._height / 2 + origins[i].y;
      const dotR = Math.max(2, 4 / z.scale);
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#e94560' : 'rgba(83, 216, 251, 0.6)';
      ctx.fill();
    }

    ctx.restore();
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const z = this._zoom;

    for (let i = this._placedWords.length - 1; i >= 0; i--) {
      const word = this._placedWords[i];
      const wx = z.tx + (this._width / 2 + word.x) * z.scale;
      const wy = z.ty + (this._height / 2 + word.y) * z.scale;
      const ww = word.spriteW * z.scale;
      const wh = word.spriteH * z.scale;

      if (clickX >= wx && clickX <= wx + ww && clickY >= wy && clickY <= wy + wh) {
        this._emit('click', { word, event: e });
        return;
      }
    }
  }
}

export function textToWords(text) {
  const counts = {};
  const tokens = text.toLowerCase().replace(/[^a-záéíóúüñàèìòùâêîôûäëïöü'-]/gi, ' ').split(/\s+/);
  for (const token of tokens) {
    const word = token.replace(/^['-]+|['-]+$/g, '');
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    counts[word] = (counts[word] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([text, value]) => ({ text, value }))
    .sort((a, b) => b.value - a.value);
}
