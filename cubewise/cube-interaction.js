import * as THREE from 'three';

// Drag-to-move: click a cubie face, drag to rotate that slice.
// Works by raycasting the click to find the face normal, then projecting
// the screen-space drag onto the face's tangent plane to determine
// the rotation axis and direction.

const DRAG_THRESHOLD = 12; // pixels before we commit to a move

// For each face normal, the two tangent axes and corresponding moves.
// tangent[i].posMove = move when dragging in +tangent direction
// tangent[i].negMove = move when dragging in -tangent direction
// The actual layer is determined by the cubie position.
const FACE_DRAGS = {
  U: [
    { axis: new THREE.Vector3(1, 0, 0), posLayer: 'z', posMove: 'F', posType: 'ccw', negMove: 'F', negType: 'cw' },
    { axis: new THREE.Vector3(0, 0, 1), posLayer: 'x', posMove: 'R', posType: 'ccw', negMove: 'R', negType: 'cw' },
  ],
  D: [
    { axis: new THREE.Vector3(1, 0, 0), posLayer: 'z', posMove: 'F', posType: 'cw', negMove: 'F', negType: 'ccw' },
    { axis: new THREE.Vector3(0, 0, 1), posLayer: 'x', posMove: 'R', posType: 'cw', negMove: 'R', negType: 'ccw' },
  ],
  F: [
    { axis: new THREE.Vector3(1, 0, 0), posLayer: 'y', posMove: 'U', posType: 'ccw', negMove: 'U', negType: 'cw' },
    { axis: new THREE.Vector3(0, 1, 0), posLayer: 'x', posMove: 'R', posType: 'cw', negMove: 'R', negType: 'ccw' },
  ],
  B: [
    { axis: new THREE.Vector3(1, 0, 0), posLayer: 'y', posMove: 'U', posType: 'cw', negMove: 'U', negType: 'ccw' },
    { axis: new THREE.Vector3(0, 1, 0), posLayer: 'x', posMove: 'L', posType: 'cw', negMove: 'L', negType: 'ccw' },
  ],
  R: [
    { axis: new THREE.Vector3(0, 0, 1), posLayer: 'y', posMove: 'U', posType: 'cw', negMove: 'U', negType: 'ccw' },
    { axis: new THREE.Vector3(0, 1, 0), posLayer: 'z', posMove: 'F', posType: 'ccw', negMove: 'F', negType: 'cw' },
  ],
  L: [
    { axis: new THREE.Vector3(0, 0, 1), posLayer: 'y', posMove: 'U', posType: 'ccw', negMove: 'U', negType: 'cw' },
    { axis: new THREE.Vector3(0, 1, 0), posLayer: 'z', posMove: 'F', posType: 'cw', negMove: 'F', negType: 'ccw' },
  ],
};

// Map layer axis + position to the actual face to rotate
const LAYER_TO_FACE = {
  'x:1':  'R',  'x:-1': 'L',
  'y:1':  'U',  'y:-1': 'D',
  'z:1':  'F',  'z:-1': 'B',
};

function normalToFace(n) {
  if (n.y >  0.5) return 'U';
  if (n.y < -0.5) return 'D';
  if (n.x >  0.5) return 'R';
  if (n.x < -0.5) return 'L';
  if (n.z >  0.5) return 'F';
  if (n.z < -0.5) return 'B';
  return null;
}

export class CubeInteraction {
  constructor(cubeRenderer, onMove) {
    this.renderer = cubeRenderer;
    this.onMove = onMove;
    this.enabled = true;
    this._down = null;

    const el = cubeRenderer.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this._onDown(e));
    el.addEventListener('pointermove', (e) => this._onDrag(e));
    el.addEventListener('pointerup',   ()  => this._onUp());
    el.addEventListener('pointerleave',()  => this._onUp());
  }

  _onDown(e) {
    if (!this.enabled) return;
    const hit = this.renderer.raycast(e.clientX, e.clientY);
    if (!hit) return;

    this._down = {
      hit,
      sx: e.clientX,
      sy: e.clientY,
      done: false,
    };
    this.renderer.controls.enabled = false;
  }

  _onDrag(e) {
    if (!this._down || this._down.done) return;

    const dx = e.clientX - this._down.sx;
    const dy = e.clientY - this._down.sy;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

    const { hit } = this._down;
    const face = normalToFace(hit.normal);
    if (!face) { this._down.done = true; return; }

    const drags = FACE_DRAGS[face];
    if (!drags) { this._down.done = true; return; }

    // Build screen-space drag vector
    const cam = this.renderer.camera;

    // Camera right and up in world space
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    const camRight = new THREE.Vector3().crossVectors(camDir, cam.up).normalize();
    const camUp = cam.up.clone().normalize();

    // World-space drag = screen dx * camRight + screen dy * (-camUp)
    const dragWorld = camRight.clone().multiplyScalar(dx)
      .add(camUp.clone().multiplyScalar(-dy));

    // Project onto each tangent axis, pick dominant
    let bestProj = 0;
    let bestDrag = null;

    for (const d of drags) {
      const proj = dragWorld.dot(d.axis);
      if (Math.abs(proj) > Math.abs(bestProj)) {
        bestProj = proj;
        bestDrag = d;
      }
    }

    if (!bestDrag) { this._down.done = true; return; }

    // Determine which layer to rotate based on cubie position
    const pos = hit.cubiePos;
    const layerVal = pos[bestDrag.posLayer];
    const layerFace = LAYER_TO_FACE[`${bestDrag.posLayer}:${layerVal}`];

    // Determine direction
    let type;
    if (bestProj > 0) {
      type = bestDrag.posType;
    } else {
      type = bestDrag.negType;
    }

    // If the layer isn't an outer face (middle slice), use the template face
    // For now, only support outer layer moves on a 3x3
    if (layerFace) {
      // Adjust type if the layer face differs from the template
      // The template assumes the positive layer; if we're on the negative layer,
      // the rotation direction reverses
      if (layerFace !== (bestProj > 0 ? bestDrag.posMove : bestDrag.negMove)) {
        type = type === 'cw' ? 'ccw' : 'cw';
      }
      this.onMove({ face: layerFace, type });
    }

    this._down.done = true;
  }

  _onUp() {
    if (this._down) {
      this.renderer.controls.enabled = true;
      this._down = null;
    }
  }
}
