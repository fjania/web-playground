import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'manifold-3d';
import { beforeAll } from 'vitest';
import { setManifoldForTesting } from '../src/domain/manifold';

// Resolve manifold.wasm via Node's module resolution so tests work
// regardless of cwd (repo root, worktree root, end-grain/, etc.). The
// previous version used `process.cwd()`, which broke whenever vitest
// was invoked from a cwd whose node_modules didn't contain manifold-3d
// — notably any git worktree that hadn't run its own `npm install`.
// manifold-3d's package.json exposes './manifold.wasm' in its exports.
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('manifold-3d/manifold.wasm');

beforeAll(async () => {
  const wasmBinary = readFileSync(wasmPath);
  const wasm = await Module({ wasmBinary });
  wasm.setup();
  setManifoldForTesting(wasm.Manifold);
}, 30_000);
