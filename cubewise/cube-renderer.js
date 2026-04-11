import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACE_NAMES, COLORS } from './cube-state.js';

const COLOR_MAP = {
  W: 0xffffff, // White
  Y: 0xffd500, // Yellow
  G: 0x009b48, // Green
  B: 0x0045ad, // Blue
  R: 0xb90000, // Red
  O: 0xff5900, // Orange
};

const INNER_COLOR = 0x111111;
const GAP = 0.06;
const CUBIE_SIZE = 1 - GAP;
const BEVEL_RADIUS = 0.08;
const BEVEL_SEGMENTS = 3;

// Map face + facelet index to cubie position and which side of the cubie
// Cubie positions: x,y,z ∈ {-1, 0, 1}
// Face directions: U=+y, D=-y, R=+x, L=-x, F=+z, B=-z
const FACE_AXIS = {
  U: { axis: 'y', value:  1, dir: new THREE.Vector3(0,  1, 0) },
  D: { axis: 'y', value: -1, dir: new THREE.Vector3(0, -1, 0) },
  R: { axis: 'x', value:  1, dir: new THREE.Vector3( 1, 0, 0) },
  L: { axis: 'x', value: -1, dir: new THREE.Vector3(-1, 0, 0) },
  F: { axis: 'z', value:  1, dir: new THREE.Vector3(0, 0,  1) },
  B: { axis: 'z', value: -1, dir: new THREE.Vector3(0, 0, -1) },
};

// For each face, map facelet index (0-8) to the cubie's (row, col) on that face,
// then to the cubie's (x, y, z) world position.
// Looking at each face from outside:
//   0 1 2
//   3 4 5
//   6 7 8
function faceletToCubiePos(face, idx) {
  const row = Math.floor(idx / 3); // 0=top, 1=mid, 2=bottom (from outside)
  const col = idx % 3;             // 0=left, 1=center, 2=right (from outside)

  // Each face has different axis mappings
  switch (face) {
    case 'U': // looking down: left=L(-x), right=R(+x), top=B(-z), bottom=F(+z)
      return { x: col - 1, y: 1, z: row - 1 };
    case 'D': // looking up: left=L(-x), right=R(+x), top=F(+z), bottom=B(-z)
      return { x: col - 1, y: -1, z: -(row - 1) };
    case 'F': // looking at front: left=L(-x), right=R(+x), top=U(+y), bottom=D(-y)
      return { x: col - 1, y: -(row - 1), z: 1 };
    case 'B': // looking at back: left=R(+x), right=L(-x), top=U(+y), bottom=D(-y)
      return { x: -(col - 1), y: -(row - 1), z: -1 };
    case 'R': // looking from right: left=F(+z), right=B(-z), top=U(+y), bottom=D(-y)
      return { x: 1, y: -(row - 1), z: -(col - 1) };
    case 'L': // looking from left: left=B(-z), right=F(+z), top=U(+y), bottom=D(-y)
      return { x: -1, y: -(row - 1), z: col - 1 };
  }
}

// Determine which face of a cubie (in local coords) corresponds to a given face direction
// Returns the face index (0-5) of the BoxGeometry: +x=0, -x=1, +y=2, -y=3, +z=4, -z=5
function faceToMaterialIndex(face) {
  switch (face) {
    case 'R': return 0; // +x
    case 'L': return 1; // -x
    case 'U': return 2; // +y
    case 'D': return 3; // -y
    case 'F': return 4; // +z
    case 'B': return 5; // -z
  }
}

export class CubeRenderer {
  constructor(container) {
    this.container = container;
    this.cubies = new Map(); // key: "x,y,z" -> { mesh, stickers }
    this.animatingGroup = null;

    this._initScene();
    this._buildCube();
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this.camera.position.set(5, 4, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 15;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    // Resize handler
    this._onResize = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  _buildCube() {
    // Rounded box geometry (shared for all cubies)
    const geometry = this._createRoundedBox(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, BEVEL_RADIUS, BEVEL_SEGMENTS);

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          // Skip the invisible center cube
          if (x === 0 && y === 0 && z === 0) continue;

          const materials = this._createCubieMaterials(x, y, z);
          const mesh = new THREE.Mesh(geometry, materials);
          mesh.position.set(x, y, z);

          // Store logical position for rotation tracking
          mesh.userData.logicalPos = { x, y, z };

          this.scene.add(mesh);
          this.cubies.set(`${x},${y},${z}`, mesh);
        }
      }
    }
  }

  _createRoundedBox(w, h, d, r, s) {
    // Use Three.js RoundedBoxGeometry if available, else fall back to BoxGeometry
    // For simplicity, use BoxGeometry with slightly smaller size + edges
    const geo = new THREE.BoxGeometry(w, h, d);
    return geo;
  }

  _createCubieMaterials(x, y, z) {
    // 6 materials: +x, -x, +y, -y, +z, -z
    return [
      new THREE.MeshStandardMaterial({ color: x ===  1 ? COLOR_MAP.R : INNER_COLOR }), // +x = R
      new THREE.MeshStandardMaterial({ color: x === -1 ? COLOR_MAP.O : INNER_COLOR }), // -x = L
      new THREE.MeshStandardMaterial({ color: y ===  1 ? COLOR_MAP.W : INNER_COLOR }), // +y = U
      new THREE.MeshStandardMaterial({ color: y === -1 ? COLOR_MAP.Y : INNER_COLOR }), // -y = D
      new THREE.MeshStandardMaterial({ color: z ===  1 ? COLOR_MAP.G : INNER_COLOR }), // +z = F
      new THREE.MeshStandardMaterial({ color: z === -1 ? COLOR_MAP.B : INNER_COLOR }), // -z = B
    ];
  }

  // Sync all cubie face colors from the state object
  updateFromState(state) {
    // First, reset all visible faces to inner color
    for (const mesh of this.cubies.values()) {
      for (const mat of mesh.material) {
        mat.color.setHex(INNER_COLOR);
      }
    }

    // Then, paint each facelet
    for (const face of FACE_NAMES) {
      for (let idx = 0; idx < 9; idx++) {
        const color = state[face][idx];
        const pos = faceletToCubiePos(face, idx);
        const key = `${pos.x},${pos.y},${pos.z}`;
        const mesh = this.cubies.get(key);
        if (!mesh) continue;

        const matIdx = faceToMaterialIndex(face);
        mesh.material[matIdx].color.setHex(COLOR_MAP[color]);
      }
    }
  }

  // Get cubies on a specific layer for animation
  getCubiesOnLayer(axis, layer) {
    const result = [];
    for (const mesh of this.cubies.values()) {
      const pos = mesh.userData.logicalPos;
      if (pos[axis] === layer) {
        result.push(mesh);
      }
    }
    return result;
  }

  // Start a rotation animation: creates a temporary group
  beginRotation(cubies) {
    const group = new THREE.Group();
    this.scene.add(group);

    for (const mesh of cubies) {
      // Remove from scene and add to group (preserving world position)
      this.scene.remove(mesh);
      group.add(mesh);
    }

    this.animatingGroup = group;
    return group;
  }

  // Finish rotation: dissolve group, snap cubies to new grid positions,
  // reset rotations (updateFromState will repaint colors correctly).
  endRotation(axis, layer, angle) {
    if (!this.animatingGroup) return;

    const group = this.animatingGroup;
    const meshes = [...group.children];

    for (const mesh of meshes) {
      // Compute world position (accounts for group rotation)
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);

      // Snap to integer grid
      const newPos = {
        x: Math.round(worldPos.x),
        y: Math.round(worldPos.y),
        z: Math.round(worldPos.z),
      };

      // Remove from group and re-add to scene
      group.remove(mesh);
      this.scene.add(mesh);

      // Reset to clean grid position with identity rotation
      // (updateFromState will repaint the correct face colors)
      mesh.position.set(newPos.x, newPos.y, newPos.z);
      mesh.rotation.set(0, 0, 0);
      mesh.userData.logicalPos = newPos;
    }

    this.scene.remove(group);
    this.animatingGroup = null;

    // Rebuild the cubies map with updated positions
    this._rebuildCubieMap();
  }

  _rebuildCubieMap() {
    this.cubies.clear();
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.userData.logicalPos) {
        const p = obj.userData.logicalPos;
        this.cubies.set(`${p.x},${p.y},${p.z}`, obj);
      }
    });
  }

  _animate() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  // Raycasting for click/drag interaction
  raycast(screenX, screenY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const meshes = Array.from(this.cubies.values());
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const normal = hit.face.normal.clone();
    // Transform normal to world space
    normal.transformDirection(hit.object.matrixWorld);
    normal.round();

    return {
      point: hit.point,
      normal,
      mesh: hit.object,
      cubiePos: hit.object.userData.logicalPos,
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    cancelAnimationFrame(this._raf);
    this.renderer.dispose();
    this.controls.dispose();
  }
}
