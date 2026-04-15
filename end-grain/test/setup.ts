import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Module from 'manifold-3d';
import { beforeAll } from 'vitest';
import { setManifoldForTesting } from '../src/domain/manifold';

beforeAll(async () => {
  const wasmBinary = readFileSync(
    resolve(process.cwd(), 'node_modules/manifold-3d/manifold.wasm'),
  );
  const wasm = await Module({ wasmBinary });
  wasm.setup();
  setManifoldForTesting(wasm.Manifold);
}, 30_000);
