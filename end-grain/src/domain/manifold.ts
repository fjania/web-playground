import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let _Manifold: any | null = null;
let _initPromise: Promise<any> | null = null;

/**
 * Initialize the manifold-3d WASM module. Idempotent; concurrent callers
 * share the same init promise. Resolves to the Manifold constructor.
 */
export async function initManifold(): Promise<any> {
  if (_Manifold) return _Manifold;
  if (!_initPromise) {
    _initPromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup();
      _Manifold = wasm.Manifold;
      return _Manifold;
    })();
  }
  return _initPromise;
}

/**
 * Synchronous accessor. Throws if called before `initManifold()` resolves.
 * Callers in hot paths (Panel methods) use this rather than paying the
 * async tax on every operation.
 */
export function getManifold(): any {
  if (!_Manifold) throw new Error('Manifold not initialized — call initManifold() first');
  return _Manifold;
}

/**
 * Test-only: inject a Manifold constructor from a caller-managed WASM init.
 * Used by Vitest setup where the `?url` import resolves to a bundler path
 * that Node can't load.
 */
export function setManifoldForTesting(M: any): void {
  _Manifold = M;
  _initPromise = Promise.resolve(M);
}
