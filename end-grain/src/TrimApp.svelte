<script lang="ts">
  /**
   * Svelte 5 port of main-trim.ts — focused harness for TrimPanel.
   *
   * Owns the timeline + counter + mutable TrimPanel feature as
   * reactive $state. URL params seed the initial state; the
   * TrimControls component mutates it; a $effect reruns the
   * pipeline on every change.
   *
   * Snapshot-is-truth: the Operation preview reads
   * `appliedBounds` from the pipeline result, not from the
   * current URL-param-derived bounds.
   */

  import { onMount } from 'svelte';
  import { initManifold } from './domain/manifold';
  import { defaultTimeline } from './state/defaultTimeline';
  import { createIdCounter, allocateId } from './state/ids';
  import { runPipeline, type PipelineOutput } from './state/pipeline';
  import { buildPanelGroup } from './scene/meshBuilder';
  import { setupViewport, type ViewportHandle } from './scene/viewport';
  import { summarize } from './render/summary';
  import { renderTrimOperation } from './render/operations';
  import TrimControls, { type TrimControlsState } from './ui/TrimControls.svelte';
  import type {
    ArrangeResult,
    ComposeStripsResult,
    CutResult,
    Feature,
    FeatureResult,
    PlaceEdit,
    Preset,
    SpacerInsert,
    Species,
    TrimPanel,
    TrimPanelResult,
  } from './state/types';

  // ---- Timeline setup (runs once at module eval) ----

  const counter = createIdCounter();
  const timeline = defaultTimeline(counter);

  const cut = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
  if (cut) {
    cut.spacingMode = 'slices';
    cut.slices = 6;
    cut.pitch = 100;
  }

  const arrangeId = timeline.find((f) => f.kind === 'arrange')?.id ?? 'arrange-0';

  const params = new URLSearchParams(window.location.search);

  // Upstream Cut overrides
  if (cut) {
    const rip = numberParam('rip');
    if (rip !== null) cut.rip = rip;
    const bevel = numberParam('bevel');
    if (bevel !== null) cut.bevel = bevel;
    const slices = numberParam('slices');
    if (slices !== null && slices > 0) {
      cut.slices = Math.floor(slices);
      cut.spacingMode = 'slices';
    }
  }

  // Upstream Arrange overrides
  for (const idx of listParam('flip')) {
    const edit: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId(counter, 'edit'),
      target: { arrangeId, sliceIdx: idx },
      op: { kind: 'rotate', degrees: 180 },
      status: 'ok',
    };
    timeline.push(edit);
  }

  const spacerWidth = numberParam('spacerWidth') ?? 5;
  const spacerSpecies = (params.get('spacerSpecies') ?? 'walnut') as Species;
  for (const afterSliceIdx of listParam('spacer')) {
    const spacer: SpacerInsert = {
      kind: 'spacerInsert',
      id: allocateId(counter, 'spacer'),
      arrangeId,
      afterSliceIdx,
      species: spacerSpecies,
      width: spacerWidth,
      status: 'ok',
    };
    timeline.push(spacer);
  }

  const presetParam = params.get('preset');
  if (presetParam) {
    for (const spec of presetParam.split(',')) {
      const [name, ...rest] = spec.trim().split(':');
      const id = allocateId(counter, 'preset');
      const preset = buildPreset(name, rest, id, arrangeId);
      if (preset) timeline.push(preset);
    }
  }

  // TrimPanel feature
  const trimMode = (params.get('mode') ?? 'flush') as TrimPanel['mode'];
  const validModes: TrimPanel['mode'][] = ['flush', 'rectangle', 'bbox'];
  const initialMode: TrimPanel['mode'] = validModes.includes(trimMode) ? trimMode : 'flush';

  let initialBounds: TrimPanel['bounds'];
  const boundsParam = params.get('bounds');
  if (boundsParam) {
    const parts = boundsParam.split(',');
    const parse = (s?: string): number | undefined => {
      if (s === undefined || s === '' || s === '_') return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };
    initialBounds = {
      xMin: parse(parts[0]),
      xMax: parse(parts[1]),
      zMin: parse(parts[2]),
      zMax: parse(parts[3]),
    };
  }

  const trimId = allocateId(counter, 'trim');
  const trim: TrimPanel = {
    kind: 'trimPanel',
    id: trimId,
    mode: initialMode,
    ...(initialBounds ? { bounds: initialBounds } : {}),
    status: 'ok',
  };
  timeline.push(trim);

  // ---- Reactive controls state (drives TrimControls) ----
  let controlsState = $state<TrimControlsState>({
    mode: trim.mode,
    bounds: trim.bounds ? { ...trim.bounds } : undefined,
  });

  function onControlsChange(next: TrimControlsState): void {
    controlsState = next;
    trim.mode = next.mode;
    if (next.bounds === undefined) {
      delete trim.bounds;
    } else {
      trim.bounds = { ...next.bounds };
    }
    tick += 1;
  }

  // ---- Pipeline output + rerun trigger ----
  let tick = $state(0);
  let pipelineOutput = $state<PipelineOutput | null>(null);
  let manifoldReady = $state(false);

  onMount(() => {
    initManifold().then(() => {
      manifoldReady = true;
      tick += 1;
    });
  });

  $effect(() => {
    // Depend on tick.
    void tick;
    if (!manifoldReady) return;
    pipelineOutput = runPipeline(timeline, { preserveLive: true });
  });

  // ---- Derived values for rendering ----
  const arrangeResult = $derived<ArrangeResult | undefined>(
    pipelineOutput?.results[arrangeId] as ArrangeResult | undefined,
  );
  const trimResult = $derived<TrimPanelResult | undefined>(
    pipelineOutput?.results[trimId] as TrimPanelResult | undefined,
  );
  const livePanel = $derived(pipelineOutput?.livePanels?.[trimId]);

  const inputSvg = $derived(arrangeResult ? summarize(arrangeResult.panel) : '');
  const opSvg = $derived(
    arrangeResult && trimResult ? renderTrimOperation(arrangeResult.panel, trimResult) : '',
  );

  const inputSubtitle = $derived.by(() => {
    if (!arrangeResult) return '';
    return `${arrangeId} · ${arrangeResult.panel.volumes.length} vols · ${cut ? `rip ${cut.rip}° · bevel ${cut.bevel}°` : ''}`;
  });
  const inputMeta = $derived.by(() => {
    if (!arrangeResult) return '';
    const ab = arrangeResult.panel.bbox;
    const ax = (ab.max[0] - ab.min[0]).toFixed(0);
    const ay = (ab.max[1] - ab.min[1]).toFixed(0);
    const az = (ab.max[2] - ab.min[2]).toFixed(0);
    return `upstream panel ${ax}×${ay}×${az} mm`;
  });

  const opSubtitle = $derived.by(() => {
    if (!trimResult) return '';
    return `${trimId} · mode=${trim.mode}${trimResult.status !== 'ok' ? ' · ' + trimResult.status : ''}`;
  });
  const opMeta = $derived.by(() => {
    if (!trimResult || !arrangeResult) return '';
    const ab = arrangeResult.panel.bbox;
    const areaPercent =
      arrangeResult.panel.volumes.length > 0
        ? ((trimResult.trimmedArea / ((ab.max[0] - ab.min[0]) * (ab.max[2] - ab.min[2]))) * 100).toFixed(1)
        : '0';
    return trimResult.trimmedArea > 0
      ? `trimmed ${trimResult.trimmedArea.toFixed(0)} mm² (${areaPercent}% of footprint)`
      : 'identity trim — no material removed';
  });

  const outputMeta = $derived.by(() => {
    if (!trimResult) return '';
    const tb = trimResult.panel.bbox;
    const tx = (tb.max[0] - tb.min[0]).toFixed(0);
    const ty = (tb.max[1] - tb.min[1]).toFixed(0);
    const tz = (tb.max[2] - tb.min[2]).toFixed(0);
    return `trimmed panel ${tx}×${ty}×${tz} mm · ${trimResult.panel.volumes.length} segments`;
  });

  const appliedBoundsText = $derived.by(() => {
    if (!trimResult) return 'bounds pending';
    const b = trimResult.appliedBounds;
    return (
      `mode       ${trim.mode}\n` +
      `xMin       ${b.xMin.toFixed(2)}\n` +
      `xMax       ${b.xMax.toFixed(2)}\n` +
      `zMin       ${b.zMin.toFixed(2)}\n` +
      `zMax       ${b.zMax.toFixed(2)}\n` +
      `width      ${(b.xMax - b.xMin).toFixed(2)} mm\n` +
      `length     ${(b.zMax - b.zMin).toFixed(2)} mm\n` +
      `trimmed    ${trimResult.trimmedArea.toFixed(2)} mm²` +
      (trimResult.statusReason ? `\n\n${trimResult.status}: ${trimResult.statusReason}` : '')
    );
  });

  const traceText = $derived.by(() => {
    if (!pipelineOutput) return 'trace pending';
    return pipelineOutput.trace
      .map((id) => {
        const r = pipelineOutput!.results[id];
        const status = r?.status ?? '?';
        const extras = briefResult(r);
        return `${id} · ${status}${extras ? ' · ' + extras : ''}`;
      })
      .join('\n');
  });

  // ---- Viewport action ----
  // Svelte action: wraps setupViewport lifecycle.
  function viewport(node: HTMLElement, panel: typeof livePanel) {
    let handle: ViewportHandle | null = null;
    let current = panel;

    function remount(p: typeof livePanel): void {
      handle?.dispose();
      handle = null;
      if (!p) return;
      const group = buildPanelGroup(p);
      handle = setupViewport(node, group);
    }

    remount(current);

    return {
      update(next: typeof livePanel): void {
        if (next === current) return;
        current = next;
        remount(next);
      },
      destroy(): void {
        handle?.dispose();
        handle = null;
      },
    };
  }

  // ---- helpers ----

  function numberParam(key: string): number | null {
    const raw = params.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function listParam(key: string): number[] {
    const raw = params.get(key);
    if (raw === null) return [];
    return raw
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.floor(n));
  }

  function buildPreset(
    name: string,
    args: string[],
    id: string,
    targetArrange: string,
  ): Preset | null {
    const base = { kind: 'preset' as const, id, arrangeId: targetArrange, status: 'ok' as const };
    switch (name) {
      case 'flipAlternate':
        return { ...base, preset: 'flipAlternate', params: {} };
      case 'mirrorAlternate':
        return { ...base, preset: 'mirrorAlternate', params: {} };
      case 'rotate4way':
        return { ...base, preset: 'rotate4way', params: {} };
      case 'rotateAlternate': {
        const deg = Number(args[0]);
        if (deg !== 90 && deg !== 180 && deg !== 270) return null;
        return { ...base, preset: 'rotateAlternate', params: { degrees: deg } };
      }
      case 'shiftAlternate': {
        const shift = Number(args[0]);
        if (!Number.isFinite(shift)) return null;
        return { ...base, preset: 'shiftAlternate', params: { shift } };
      }
      case 'spacerEveryRow': {
        const width = Number(args[0]);
        if (!Number.isFinite(width) || width <= 0) return null;
        const species = (args[1] ?? 'walnut') as Species;
        return { ...base, preset: 'spacerEveryRow', params: { species, width } };
      }
      default:
        return null;
    }
  }

  function briefResult(r: FeatureResult | undefined): string {
    if (!r) return '';
    if ('slices' in r && Array.isArray((r as CutResult).slices)) {
      const cr = r as CutResult;
      return `${cr.slices.length} slices · ${cr.offcuts.length} offcuts`;
    }
    if ('appliedBounds' in r) {
      const tr = r as TrimPanelResult;
      const b = tr.appliedBounds;
      const w = (b.xMax - b.xMin).toFixed(0);
      const l = (b.zMax - b.zMin).toFixed(0);
      return `trimmed to ${w}×${l} mm`;
    }
    if ('panel' in r && (r as ArrangeResult | ComposeStripsResult).panel) {
      const pr = r as ArrangeResult | ComposeStripsResult;
      return `${pr.panel.volumes.length} vols`;
    }
    return '';
  }
</script>

<main id="tiles">
  <article class="tile tile--2d" data-stage={arrangeId} data-role="input">
    <header>
      <h2>Input</h2>
      <p class="subtitle">{inputSubtitle || `${arrangeId} · panel flowing into trim`}</p>
    </header>
    <div class="render" data-slot="render">
      {#if inputSvg}
        {@html inputSvg}
      {:else}
        <div class="placeholder">input pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{inputMeta}</div>
  </article>

  <article class="tile tile--2d" data-stage="trim-0-op" data-role="operation">
    <header>
      <h2>Operation: TrimPanel</h2>
      <p class="subtitle">{opSubtitle || 'trim-0 · trim rect + discard overlay'}</p>
    </header>
    <div class="render op-render" data-slot="render">
      <div class="op-controls">
        <TrimControls state={controlsState} onChange={onControlsChange} />
      </div>
      <div class="op-preview">
        {#if opSvg}
          {@html opSvg}
        {:else}
          <div class="placeholder">operation diagram pending</div>
        {/if}
      </div>
    </div>
    <div class="meta" data-slot="meta">{opMeta}</div>
  </article>

  <article class="tile tile--3d" data-stage={trimId} data-role="output">
    <header>
      <h2>Output</h2>
      <p class="subtitle">trimmed panel · 3D viewport</p>
    </header>
    <div class="render" data-slot="render">
      {#if livePanel}
        {#key livePanel}
          <div class="viewport-host" use:viewport={livePanel}></div>
        {/key}
      {:else}
        <div class="placeholder">3D viewport pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{outputMeta}</div>
  </article>
</main>

<aside id="inspector" aria-label="Harness help">
  <header>
    <h2>TrimPanel harness</h2>
  </header>
  <div class="inspector-body">
    <section>
      <h3>URL parameters</h3>
      <div class="hint">Trim parameters
  <code>?mode=flush</code>      (default) largest inscribed rect
                    in the panel's top-face outline
  <code>?mode=rectangle</code>  intersect top + bottom footprints
                    (matters at bevel != 90°)
  <code>?mode=bbox</code>       user-supplied bounds — omit fields
                    to inherit the panel's extent on that axis
  <code>?bounds=-40,40,-150,150</code>
                    xMin,xMax,zMin,zMax (mm) for bbox mode.
                    Use <code>_</code> for omitted fields:
                    <code>?bounds=-40,40,_,_</code> trims X only.

Upstream Cut (same as the Cut harness)
  <code>?rip=30</code>      rip angle in degrees (default 0)
  <code>?bevel=60</code>    bevel angle 45..90 (default 90)
  <code>?slices=6</code>    how many slices to cut (default 6)

Upstream Arrange (same as the Arrange harness)
  <code>?flip=1,3</code>    rotate 180° on these slice indices
  <code>?spacer=1,3</code>  insert spacers after these indices
  <code>?spacerWidth=10</code>   width in mm (default 5)
  <code>?spacerSpecies=maple</code>  species (default walnut)
  <code>?preset=flipAlternate</code>
  <code>?preset=spacerEveryRow:6</code>
  Multiple presets: <code>?preset=flipAlternate,spacerEveryRow:5</code>

Examples
  Default flush trim on an angled glue-up:
    <code>?rip=30&amp;slices=6</code>
  Trim to a specific size:
    <code>?mode=bbox&amp;bounds=-40,40,-150,150</code>
  Bevel + rectangle mode:
    <code>?bevel=60&amp;slices=6&amp;mode=rectangle</code>
  Arrange pattern + flush trim:
    <code>?rip=30&amp;slices=8&amp;preset=flipAlternate,spacerEveryRow:5</code>
      </div>
    </section>
    <section>
      <h3>Applied bounds</h3>
      <div data-slot="applied-bounds" class="hint">{appliedBoundsText}</div>
    </section>
    <section>
      <h3>Pipeline trace</h3>
      <div data-slot="trace" class="hint">{traceText}</div>
    </section>
  </div>
</aside>

<style>
  .op-render {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    align-items: stretch;
    justify-content: flex-start;
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
