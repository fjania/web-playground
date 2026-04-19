import {
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

function makeAxis(dir: Vector3, color: number): Line {
  const mat = new LineBasicMaterial({ color });
  const pts = [new Vector3(0, 0, 0), dir.clone()];
  const geo = new BufferGeometry().setFromPoints(pts);
  return new Line(geo, mat);
}

function makeAxisLabel(text: string, position: Vector3, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);
  const tex = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false }));
  sprite.position.copy(position);
  sprite.scale.set(0.3, 0.3, 1);
  return sprite;
}

/**
 * A minimal scene with a camera + a small X/Y/Z gizmo. Render this in each
 * tile's bottom-left corner as a compass. Call `alignTo(camera)` every frame
 * so the gizmo mirrors the main camera's orientation.
 */
export interface AxesOverlay {
  scene: Scene;
  camera: PerspectiveCamera;
  group: Group;
  alignTo(mainCamera: { quaternion: { clone(): any } }): void;
}

export function createAxesOverlay(): AxesOverlay {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  const group = new Group();
  group.add(makeAxis(new Vector3(1, 0, 0), 0xff4444));
  group.add(makeAxis(new Vector3(0, 1, 0), 0x44ff44));
  group.add(makeAxis(new Vector3(0, 0, 1), 0x4488ff));
  group.add(makeAxisLabel('X', new Vector3(1.2, 0, 0), '#ff4444'));
  group.add(makeAxisLabel('Y', new Vector3(0, 1.2, 0), '#44ff44'));
  group.add(makeAxisLabel('Z', new Vector3(0, 0, 1.2), '#4488ff'));
  scene.add(group);

  return {
    scene,
    camera,
    group,
    alignTo(mainCamera) {
      group.quaternion.copy(mainCamera.quaternion.clone()).invert();
    },
  };
}
