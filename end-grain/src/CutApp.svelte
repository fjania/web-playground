<script lang="ts">
  /**
   * Svelte 5 port of main-cut.ts — focused harness for the Cut
   * operation.
   *
   * Owns the timeline + mutable Cut feature as reactive state.
   * Preserves the tile-promote behaviour: clicking a 2D tile (input
   * or operation) promotes it to a live 3D viewport; clicking again
   * restores the 2D summary. WebGL budget: at most 2 concurrent
   * viewports (the always-on output tile + at most one promoted
   * tile).
   *
   * Debug inspector stays imperative (mountInspector) — it will be
   * ported in Checkpoint 3.
   */

  import { onMount } from 'svelte';
  import { Group } from 'three';

  import { initManifold } from './domain/manifold';
  import { defaultTimeline } from './state/defaultTimeline';
  import { createIdCounter } from './state/ids';
  import { runPipeline, type PipelineOutput } from './state/pipeline';
  import {
    buildGroupFromSnapshot,
    buildPanelGroup,
  } from './scene/meshBuilder';
  import { setupViewport, type ViewportHandle } from './scene/viewport';
  import { summarize } from './render/summary';
  import { renderCutOperation } from './render/operations';
  import { mountInspector } from './ui/debugInspector';
  import CutControls, { type CutControlsState } from './ui/CutControls.svelte';
  import type { Panel } from './domain/Panel';
  import type {
    ComposeStripsResult,
    Cut,
    CutResult,
    Feature,
    PanelSnapshot,
  } from './state/types';

  // ---- Timeline setup ----

  const timeline = defaultTimeline(createIdCounter());
  const cut = timeline.find((f): f is Cut => f.kind === 'cut');
  if (!cut) throw new Error('default timeline missing a Cut feature');

  applyCutUrlSeeds(cut);

  const finalArrangeId = findLastArrangeId(timeline);
  if (!finalArrangeId) throw new Error('no arrange in timeline');

  // ---- Reactive state ----

  let controlsState = $state<CutControlsState>({
    orientation: cut.orientation,
    rip: cut.rip,
    bevel: cut.bevel,
    spacingMode: cut.spacingMode,
    pitch: cut.pitch,
    slices: cut.slices,
    showOffcuts: cut.showOffcuts,
  });

  let tick = $state(0);
  let output = $state<PipelineOutput | null>(null);
  let manifoldReady = $state(false);

  /** Which non-final tile is currently promoted to 3D, if any. */
  let promotedStageId = $state<string | null>(null);

  function onControlsChange(next: CutControlsState): void {
    controlsState = next;
    cut.orientation = next.orientation;
    cut.rip = next.rip;
    cut.bevel = next.bevel;
    cut.spacingMode = next.spacingMode;
    cut.pitch = next.pitch;
    cut.slices = next.slices;
    cut.showOffcuts = next.showOffcuts;
    tick += 1;
  }

  onMount(() => {
    initManifold().then(() => {
      manifoldReady = true;
      tick += 1;
    });
  });

  $effect(() => {
    void tick;
    if (!manifoldReady) return;
    // A rerun invalidates any promoted 3D viewport (its live Panel
    // would be disposed by the new pipeline pass).
    promotedStageId = null;
    output = runPipeline(timeline, { preserveLive: true });
  });

  // Drive the imperative debug inspector off pipeline output.
  $effect(() => {
    if (!output) return;
    mountInspector({ timeline, output });
  });

  // ---- Derived values ----

  const composeResult = $derived<ComposeStripsResult | undefined>(
    output?.results['compose-0'] as ComposeStripsResult | undefined,
  );
  const cutResult = $derived<CutResult | undefined>(
    output?.results['cut-0'] as CutResult | undefined,
  );
  const finalPanel = $derived(output?.livePanels?.[finalArrangeId]);
  const liveCutSlices = $derived(output?.liveCutSlices?.['cut-0'] ?? []);

  const inputSvg = $derived(composeResult ? summarize(composeResult.panel) : '');
  const opSvg = $derived(cutResult ? renderCutOperation(cutResult) : '');

  const inputMeta = $derived.by(() => {
    if (!composeResult) return '';
    const xExt = (composeResult.panel.bbox.max[0] - composeResult.panel.bbox.min[0]).toFixed(0);
    const zExt = (composeResult.panel.bbox.max[2] - composeResult.panel.bbox.min[2]).toFixed(0);
    return `${composeResult.panel.volumes.length} strips · ${xExt}×${zExt} mm`;
  });

  const opSubtitle = $derived.by(() => {
    const density =
      controlsState.spacingMode === 'slices'
        ? `${controlsState.slices} slices`
        : `pitch ${controlsState.pitch}`;
    return `cut-0 · rip ${controlsState.rip}° · ${density} · bevel ${controlsState.bevel}°`;
  });

  const opMeta = $derived.by(() => {
    if (!cutResult) return '';
    return cutResult.offcuts.length > 0
      ? `→ ${cutResult.slices.length} inner slices (${cutResult.offcuts.length} offcuts discarded)`
      : `→ ${cutResult.slices.length} slices (no offcuts — cuts span the full panel)`;
  });

  const outputMeta = $derived.by(() => {
    if (!cutResult) return '';
    const totalVolumes = cutResult.slices.reduce((n, s) => n + s.volumes.length, 0);
    return cutResult.offcuts.length > 0
      ? `${cutResult.slices.length} slices · ${totalVolumes} segments · ${cutResult.offcuts.length} offcuts discarded`
      : `${cutResult.slices.length} slices · ${totalVolumes} segments`;
  });

  // ---- Live 3D group for the Output tile ----

  function buildOutputGroup(result: CutResult, slices: Panel[]): Group {
    const group = new Group();

    type PieceKind = 'slice' | 'offcut';
    type Piece = {
      snap: PanelSnapshot;
      kind: PieceKind;
      live?: Panel;
    };
    const pieces: Piece[] = [];
    if (result.offcuts[0]) pieces.push({ snap: result.offcuts[0], kind: 'offcut' });
    result.slices.forEach((s, i) => {
      pieces.push({ snap: s, kind: 'slice', live: slices[i] });
    });
    if (result.offcuts[1]) pieces.push({ snap: result.offcuts[1], kind: 'offcut' });
    if (pieces.length === 0) return group;

    let gap = 0;
    for (const p of pieces) {
      const v = p.snap.volumes[0];
      if (v) { gap = v.bbox.max[1] - v.bbox.min[1]; break; }
    }

    const centerIdx = (pieces.length - 1) / 2;

    pieces.forEach((piece, i) => {
      const meshGroup = piece.live
        ? buildPanelGroup(piece.live)
        : buildGroupFromSnapshot(piece.snap);
      meshGroup.position.z = (i - centerIdx) * gap;

      meshGroup.userData.kind = piece.kind;
      if (piece.kind === 'slice') {
        meshGroup.userData.sliceIdx = i - (result.offcuts[0] ? 1 : 0);
      }

      if (piece.kind === 'offcut') {
        meshGroup.traverse((obj) => {
          const anyObj = obj as unknown as {
            isMesh?: boolean;
            isLineSegments?: boolean;
            material?: {
              transparent: boolean;
              opacity: number;
              depthWrite?: boolean;
            };
          };
          if (anyObj.isMesh && anyObj.material) {
            anyObj.material.transparent = true;
            anyObj.material.opacity = 0.2;
            anyObj.material.depthWrite = false;
          }
          if (anyObj.isLineSegments && anyObj.material) {
            anyObj.material.transparent = true;
            anyObj.material.opacity = 0.15;
          }
        });
      }

      group.add(meshGroup);
    });

    return group;
  }

  // ---- Svelte actions for viewports ----

  /** Always-on final viewport. Remounts whenever cutResult changes. */
  function finalViewport(node: HTMLElement, arg: { result: CutResult; slices: Panel[] }) {
    let handle: ViewportHandle | null = null;

    function remount(next: { result: CutResult; slices: Panel[] }): void {
      handle?.dispose();
      handle = setupViewport(node, buildOutputGroup(next.result, next.slices), {
        mode: '3d-final',
      });
    }

    remount(arg);

    return {
      update(next: { result: CutResult; slices: Panel[] }): void {
        remount(next);
      },
      destroy(): void {
        handle?.dispose();
      },
    };
  }

  /** Promoted tile viewport (input / operation). */
  function promotedViewport(node: HTMLElement, panel: Panel) {
    let handle: ViewportHandle | null = null;

    function remount(p: Panel): void {
      handle?.dispose();
      handle = setupViewport(node, buildPanelGroup(p), { mode: '3d-active' });
    }

    remount(panel);

    return {
      update(next: Panel): void {
        remount(next);
      },
      destroy(): void {
        handle?.dispose();
      },
    };
  }

  // ---- Tile click handling ----

  function promote(stageId: string, e: MouseEvent): void {
    // Ignore clicks inside the controls region so slider/button
    // interactions don't toggle the tile.
    if ((e.target as Element).closest('.cut-controls')) return;
    if (!output?.livePanels?.[stageId]) return;
    promotedStageId = promotedStageId === stageId ? null : stageId;
  }

  // ---- URL seeds ----

  function applyCutUrlSeeds(c: Cut): void {
    const params = new URLSearchParams(window.location.search);
    const orient = params.get('orientation') ?? params.get('orient');
    if (orient !== null) {
      const v = Number(orient);
      if (v === 0 || v === 90) c.orientation = v;
    }
    const rip = params.get('rip');
    if (rip !== null) {
      const v = Number(rip);
      if (Number.isFinite(v)) c.rip = v;
    }
    const bevel = params.get('bevel');
    if (bevel !== null) {
      const v = Number(bevel);
      if (Number.isFinite(v)) c.bevel = v;
    }
    const pitch = params.get('pitch');
    if (pitch !== null) {
      const v = Number(pitch);
      if (Number.isFinite(v) && v > 0) {
        c.pitch = v;
        c.spacingMode = 'pitch';
      }
    }
    const slices = params.get('slices');
    if (slices !== null) {
      const v = Number(slices);
      if (Number.isFinite(v) && v > 0) {
        c.slices = Math.floor(v);
        c.spacingMode = 'slices';
      }
    }
    const mode = params.get('mode');
    if (mode === 'pitch' || mode === 'slices') c.spacingMode = mode;
  }

  function findLastArrangeId(features: Feature[]): string | null {
    for (let i = features.length - 1; i >= 0; i--) {
      const f = features[i];
      if (f.kind === 'arrange') return f.id;
    }
    return null;
  }

  // ---- Live panels for promoted tiles ----
  const composePromotedPanel = $derived(
    promotedStageId === 'compose-0' ? output?.livePanels?.['compose-0'] : undefined,
  );
  const cutPromotedPanel = $derived(
    promotedStageId === 'cut-0' ? output?.livePanels?.['cut-0'] : undefined,
  );

  const composeMode = $derived(
    promotedStageId === 'compose-0' ? '3d-active' : '2d-summary',
  );
  const cutMode = $derived(
    promotedStageId === 'cut-0' ? '3d-active' : '2d-summary',
  );
</script>

<main id="tiles">
  <article
    class="tile tile--2d"
    data-stage="compose-0"
    data-role="input"
    data-mode={composeMode}
    onclick={(e) => promote('compose-0', e)}
  >
    <header>
      <h2>Input</h2>
      <p class="subtitle">compose-0 · the panel being operated on</p>
    </header>
    <div class="render" data-slot="render">
      {#if composePromotedPanel}
        {#key composePromotedPanel}
          <div class="viewport-host" use:promotedViewport={composePromotedPanel}></div>
        {/key}
      {:else if inputSvg}
        {@html inputSvg}
      {:else}
        <div class="placeholder">input pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{inputMeta}</div>
  </article>

  <article
    class="tile tile--2d"
    data-stage="cut-0"
    data-role="operation"
    data-mode={cutMode}
    onclick={(e) => promote('cut-0', e)}
  >
    <header>
      <h2>Operation: Cut</h2>
      <p class="subtitle">{opSubtitle}</p>
    </header>
    <div class="render op-render" data-slot="render">
      {#if cutPromotedPanel}
        {#key cutPromotedPanel}
          <div class="viewport-host" use:promotedViewport={cutPromotedPanel}></div>
        {/key}
      {:else}
        <div class="op-controls">
          <CutControls state={controlsState} onChange={onControlsChange} />
        </div>
        <div class="op-preview">
          {#if opSvg}
            {@html opSvg}
          {:else}
            <div class="placeholder">operation diagram pending</div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{opMeta}</div>
  </article>

  <article
    class="tile tile--3d"
    data-stage={finalArrangeId}
    data-role="output"
    data-mode="3d-final"
  >
    <header>
      <h2>Output</h2>
      <p class="subtitle">slices from cut-0 · 3D viewport</p>
    </header>
    <div class="render" data-slot="render">
      {#if cutResult && finalPanel}
        {#key cutResult}
          <div
            class="viewport-host"
            use:finalViewport={{ result: cutResult, slices: liveCutSlices }}
          ></div>
        {/key}
      {:else}
        <div class="placeholder">3D viewport pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{outputMeta}</div>
  </article>
</main>

<style>
  .op-render {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    align-items: stretch;
    justify-content: flex-start;
  }
  .op-render :global(.placeholder) {
    margin: auto;
  }
  .op-controls {
    background: #fff;
    border: 1px solid #e4e4e0;
    border-radius: 4px;
    padding: 0.45rem 0.55rem;
    flex: 0 0 auto;
  }
  .op-preview {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  .viewport-host {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
