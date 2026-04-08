'use strict';

let generation = 0;

onmessage = function (e) {
  if (e.data.cmd === 'start') {
    generation++;
    runLayout(e.data.sprites, e.data.config, generation);
  }
};

function runLayout(sprites, config, gen) {
  const startTime = performance.now();
  const { width, height, layout } = config;

  const boardW = Math.ceil(width * 2);
  const boardH = Math.ceil(height * 2);
  const boardW32 = Math.ceil(boardW / 32);
  const board = new Uint32Array(boardW32 * boardH);

  const cx = Math.floor(boardW / 2);
  const cy = Math.floor(boardH / 2);
  const aspect = width / height;
  const placeFn = getPlaceFn(layout || 'spiral');

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let placed = 0;
  let skipped = 0;
  const total = sprites.length;

  for (let si = 0; si < total; si++) {
    if (gen !== generation) return;

    const s = sprites[si];
    const pos = placeFn(s, board, boardW32, boardH, cx, cy, aspect, si, total);

    if (pos) {
      placeOnBoard(s.data, s.w32, s.h, pos.bx, pos.by, board, boardW32);

      const lx = pos.bx - cx;
      const ly = pos.by - cy;
      bounds.minX = Math.min(bounds.minX, lx);
      bounds.minY = Math.min(bounds.minY, ly);
      bounds.maxX = Math.max(bounds.maxX, lx + s.w);
      bounds.maxY = Math.max(bounds.maxY, ly + s.h);

      placed++;

      postMessage({
        cmd: 'wordPlaced',
        word: {
          text: s.text, x: lx, y: ly,
          fontSize: s.fontSize, rotation: s.rotation, color: s.color,
          spriteW: s.w, spriteH: s.h, textX: s.textX, textY: s.textY,
        },
        progress: { placed: placed, total: total },
      });
    } else {
      skipped++;
    }
  }

  postMessage({
    cmd: 'complete', bounds: bounds,
    debugOrigins: wanderingOrigins,
    stats: { timeMs: Math.round(performance.now() - startTime), placed: placed, skipped: skipped },
  });
}

function testPosition(spriteData, sw32, sh, bx, by, board, boardW32, boardH) {
  if (bx < 0 || by < 0 || by + sh > boardH) return false;

  const bitOffset = bx & 31;
  const wordOffset = bx >> 5;

  if (bx + sw32 * 32 > boardW32 * 32) return false;

  if (bitOffset === 0) {
    for (let y = 0; y < sh; y++) {
      const boardRow = (by + y) * boardW32;
      const spriteRow = y * sw32;
      for (let i = 0; i < sw32; i++) {
        if (spriteData[spriteRow + i] & board[boardRow + wordOffset + i]) return false;
      }
    }
  } else {
    const rShift = bitOffset;
    const lShift = 32 - bitOffset;
    for (let y = 0; y < sh; y++) {
      const boardRow = (by + y) * boardW32;
      const spriteRow = y * sw32;
      for (let i = 0; i < sw32; i++) {
        const bits = spriteData[spriteRow + i];
        if (bits === 0) continue;

        const bIdx = wordOffset + i;
        if ((bits >>> rShift) & board[boardRow + bIdx]) return false;
        if (bIdx + 1 < boardW32) {
          if ((bits << lShift) & board[boardRow + bIdx + 1]) return false;
        }
      }
    }
  }

  return true;
}

function placeOnBoard(spriteData, sw32, sh, bx, by, board, boardW32) {
  const bitOffset = bx & 31;
  const wordOffset = bx >> 5;

  if (bitOffset === 0) {
    for (let y = 0; y < sh; y++) {
      const boardRow = (by + y) * boardW32;
      const spriteRow = y * sw32;
      for (let i = 0; i < sw32; i++) {
        board[boardRow + wordOffset + i] |= spriteData[spriteRow + i];
      }
    }
  } else {
    const rShift = bitOffset;
    const lShift = 32 - bitOffset;
    for (let y = 0; y < sh; y++) {
      const boardRow = (by + y) * boardW32;
      const spriteRow = y * sw32;
      for (let i = 0; i < sw32; i++) {
        const bits = spriteData[spriteRow + i];
        if (bits === 0) continue;
        const bIdx = wordOffset + i;
        if (bIdx < boardW32) board[boardRow + bIdx] |= bits >>> rShift;
        if (bIdx + 1 < boardW32) board[boardRow + bIdx + 1] |= bits << lShift;
      }
    }
  }
}

var wanderingOrigins = [];
var wanderBaseAngle = 0;

// Chosen once per layout run, used by rectangular placement
var rectAspect = 1;

function getPlaceFn(layout) {
  switch (layout) {
    case 'rectangular':
      // Random aspect ratio, biased toward moderate values.
      // Use a normal-ish distribution: square the random to make extremes less likely.
      var r = Math.random();
      var range = 0.4 + r * r * 2.1; // 0.4 to 2.5, biased toward lower end
      // Randomly pick landscape or portrait
      rectAspect = Math.random() < 0.5 ? range : 1 / range;
      // Ensure it's never close enough to 1.0 to look square
      if (rectAspect > 0.85 && rectAspect < 1.18) {
        rectAspect = Math.random() < 0.5 ? 0.65 : 1.5;
      }
      return placeRectangular;
    case 'square':
      rectAspect = 1;
      return placeRectangular;
    case 'tetris': return placeTetris;
    case 'wander-line': return placeWanderLine;
    case 'wander-curl': return placeWanderCurl;
    case 'wander-wisp': return placeWanderWisp;
    case 'wander-feather': return placeWanderFeather;
    case 'wander-ring': return placeWanderRing;
    default: return placeSpiral;
  }
}

// --- Layout 1: Archimedean Spiral ---
function placeSpiral(sprite, board, boardW32, boardH, cx, cy, aspect) {
  const maxSteps = 50000;
  const dt = 0.05;
  const startAngle = Math.random() * Math.PI * 2;

  for (let t = 0; t < maxSteps; t++) {
    const theta = startAngle + dt * t;
    const r = dt * t * 0.5;
    const x = Math.round(cx + r * Math.cos(theta) * aspect - sprite.w / 2);
    const y = Math.round(cy + r * Math.sin(theta) - sprite.h / 2);

    if (testPosition(sprite.data, sprite.w32, sprite.h, x, y, board, boardW32, boardH)) {
      return { bx: x, by: y };
    }
  }
  return null;
}

// --- Layout 2a: Wandering Diagonal ---
// Origins march along a 30-degree line from center.
function placeWanderLine(sprite, board, boardW32, boardH, cx, cy, aspect, si, total) {
  if (si === 0) { wanderingOrigins = []; wanderBaseAngle = Math.random() * Math.PI * 2; }
  const lineAngle = wanderBaseAngle;
  const spacing = Math.min(cx, cy) * 1.2 / Math.max(total, 1);
  const sign = si % 2 === 0 ? 1 : -1;
  const dist = Math.ceil(si / 2) * spacing * sign;
  const originX = cx + Math.round(dist * Math.cos(lineAngle) * aspect);
  const originY = cy + Math.round(dist * Math.sin(lineAngle));
  wanderingOrigins.push({ x: originX - cx, y: originY - cy });
  return placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect);
}

// --- Layout 2b: Wandering Curl (pinwheel) ---
// Two arms extend from center in opposite directions, each curving ~90°.
// Even words on one arm, odd words on the other. Rotationally symmetric.
function placeWanderCurl(sprite, board, boardW32, boardH, cx, cy, aspect, si, total) {
  if (si === 0) { wanderingOrigins = []; wanderBaseAngle = Math.random() * Math.PI * 2; }
  const maxR = Math.min(cx, cy) * 0.7;
  const arm = si % 2;  // 0 or 1
  const armIndex = Math.floor(si / 2);
  const armTotal = Math.ceil(total / 2);
  const t = armIndex / Math.max(armTotal - 1, 1);
  const armOffset = arm * Math.PI; // opposite arm is 180° away
  const theta = wanderBaseAngle + armOffset + t * Math.PI / 2; // each arm curves 90°
  const r = t * maxR;
  const originX = cx + Math.round(r * Math.cos(theta) * aspect);
  const originY = cy + Math.round(r * Math.sin(theta));
  wanderingOrigins.push({ x: originX - cx, y: originY - cy });
  return placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect);
}

// --- Layout 2c: Wandering Wisp (pinwheel, subtle) ---
// Two arms, each curving only ~22.5°. Tighter pinwheel.
function placeWanderWisp(sprite, board, boardW32, boardH, cx, cy, aspect, si, total) {
  if (si === 0) { wanderingOrigins = []; wanderBaseAngle = Math.random() * Math.PI * 2; }
  const maxR = Math.min(cx, cy) * 0.7;
  const arm = si % 2;
  const armIndex = Math.floor(si / 2);
  const armTotal = Math.ceil(total / 2);
  const t = armIndex / Math.max(armTotal - 1, 1);
  const armOffset = arm * Math.PI;
  const theta = wanderBaseAngle + armOffset + t * Math.PI / 8; // each arm curves 22.5°
  const r = t * maxR;
  const originX = cx + Math.round(r * Math.cos(theta) * aspect);
  const originY = cy + Math.round(r * Math.sin(theta));
  wanderingOrigins.push({ x: originX - cx, y: originY - cy });
  return placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect);
}

// --- Layout 2d: Wandering Feather ---
// Single gentle 45° arc, no alternation. The original wisp behavior.
function placeWanderFeather(sprite, board, boardW32, boardH, cx, cy, aspect, si, total) {
  if (si === 0) { wanderingOrigins = []; wanderBaseAngle = Math.random() * Math.PI * 2; }
  const maxR = Math.min(cx, cy) * 0.7;
  const theta = wanderBaseAngle + (si / Math.max(total - 1, 1)) * Math.PI / 4;
  const r = (si / Math.max(total - 1, 1)) * maxR;
  const originX = cx + Math.round(r * Math.cos(theta) * aspect);
  const originY = cy + Math.round(r * Math.sin(theta));
  wanderingOrigins.push({ x: originX - cx, y: originY - cy });
  return placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect);
}

// --- Layout 2d: Wandering Ring ---
// Origins follow a circle, starting from a random angle.
function placeWanderRing(sprite, board, boardW32, boardH, cx, cy, aspect, si, total) {
  if (si === 0) { wanderingOrigins = []; wanderBaseAngle = Math.random() * Math.PI * 2; }
  const radius = Math.min(cx, cy) * 0.35;
  const theta = wanderBaseAngle + (si / Math.max(total, 1)) * Math.PI * 2;
  const originX = cx + Math.round(radius * Math.cos(theta) * aspect);
  const originY = cy + Math.round(radius * Math.sin(theta));
  wanderingOrigins.push({ x: originX - cx, y: originY - cy });
  return placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect);
}

// Shared: place a word starting from a given origin using a tight spiral search
function placeFromOrigin(sprite, board, boardW32, boardH, originX, originY, aspect) {
  const maxSteps = 50000;
  const dt = 0.05;
  for (let t = 0; t < maxSteps; t++) {
    const theta = dt * t;
    const r = dt * t * 0.5;
    const x = Math.round(originX + r * Math.cos(theta) * aspect - sprite.w / 2);
    const y = Math.round(originY + r * Math.sin(theta) - sprite.h / 2);
    if (testPosition(sprite.data, sprite.w32, sprite.h, x, y, board, boardW32, boardH)) {
      return { bx: x, by: y };
    }
  }
  return null;
}

// --- Layout 3: Rectangular Spiral ---
// Uses rectAspect to stretch horizontally (>1) or vertically (<1).
function placeRectangular(sprite, board, boardW32, boardH, cx, cy, aspect) {
  const step = 2;
  let x = cx - Math.floor(sprite.w / 2);
  let y = cy - Math.floor(sprite.h / 2);
  // Scale step sizes by rectAspect so the spiral traces a rectangle
  const ra = rectAspect;
  let dx = Math.round(step * ra), dy = 0;
  let segmentLen = Math.round(step * 4 * (dx !== 0 ? ra : 1));
  let segmentPassed = 0;
  let turnCount = 0;
  let horizontal = true; // track which axis we're moving on

  for (let i = 0; i < 200000; i++) {
    if (testPosition(sprite.data, sprite.w32, sprite.h, x, y, board, boardW32, boardH)) {
      return { bx: x, by: y };
    }

    x += dx;
    y += dy;
    segmentPassed += Math.abs(dx || dy);

    if (segmentPassed >= segmentLen) {
      segmentPassed = 0;
      turnCount++;
      // Rotate 90 degrees
      const tmp = dx;
      dx = -dy;
      dy = tmp;
      horizontal = !horizontal;
      // Scale segment length by aspect on horizontal legs
      const baseLen = step * 4;
      const growth = Math.floor(turnCount / 2) * step * 4;
      segmentLen = Math.round((baseLen + growth) * (horizontal ? ra : 1));
    }
  }
  return null;
}

// --- Layout 4: Tetris Pack ---
// Scans left-to-right, bottom-to-top, placing each word at the lowest available position.
function placeTetris(sprite, board, boardW32, boardH, cx, cy, aspect) {
  const scanStep = 3;
  const startY = Math.min(boardH - sprite.h, cy + Math.floor(boardH * 0.4));
  const endY = Math.max(0, cy - Math.floor(boardH * 0.4));
  const startX = Math.max(0, cx - Math.floor(cx * 0.9));
  const endX = Math.min(boardW32 * 32 - sprite.w, cx + Math.floor(cx * 0.9));

  for (let y = startY; y >= endY; y -= scanStep) {
    for (let x = startX; x <= endX; x += scanStep) {
      if (testPosition(sprite.data, sprite.w32, sprite.h, x, y, board, boardW32, boardH)) {
        return { bx: x, by: y };
      }
    }
  }
  return null;
}
