<script lang="ts">
  /**
   * Svelte 5 port of main-arrange.ts — focused harness for Arrange.
   *
   * Reuses the default compose + cut + arrange timeline, pares the
   * cut down to a legible N-slice count, and reads URL params to
   * inject per-slice PlaceEdits, SpacerInserts, and Presets into
   * the timeline targeting arrange-0.
   *
   * URL-only: the harness itself has no live controls — one
   * pipeline pass at load. ArrangeEditList etc. are reserved for
   * the workbench.
   */

  import { onMount } from 'svelte';
  import { initManifold } from './domain/manifold';
  import { defaultTimeline } from './state/defaultTimeline';
  import { createIdCounter, allocateId } from './state/ids';
  import { runPipeline, type PipelineOutput } from './state/pipeline';
  import { buildPanelGroup } from './scene/meshBuilder';
  import { setupViewport, type ViewportHandle } from './scene/viewport';
  import { summarizeSlices } from './render/summary';
  import { renderArrangeOperation } from './render/operations';
  import type { Panel } from './domain/Panel';
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
  } from './state/types';

  // ---- Timeline assembly (runs once at module eval) ----

  const counter = createIdCounter();
  const timeline = defaultTimeline(counter);

  const cut = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
  if (cut) {
    cut.spacingMode = 'slices';
    cut.slices = 4;
    cut.pitch = 100;
  }

  const arrangeId = timeline.find((f) => f.kind === 'arrange')?.id ?? 'arrange-0';
  const params = new URLSearchParams(window.location.search);

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

  const shiftParam = params.get('shift');
  if (shiftParam) {
    for (const pair of shiftParam.split(',')) {
      const [idxStr, deltaStr] = pair.split(':');
      const idx = Number(idxStr);
      const delta = Number(deltaStr);
      if (!Number.isFinite(idx) || !Number.isFinite(delta)) continue;
      timeline.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId, sliceIdx: Math.floor(idx) },
        op: { kind: 'shift', delta },
        status: 'ok',
      });
    }
  }

  const rotateParam = params.get('rotate');
  if (rotateParam) {
    for (const pair of rotateParam.split(',')) {
      const [idxStr, degStr] = pair.split(':');
      const idx = Number(idxStr);
      const degrees = Number(degStr);
      if (!Number.isFinite(idx) || !Number.isFinite(degrees)) continue;
      timeline.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId, sliceIdx: Math.floor(idx) },
        op: { kind: 'rotate', degrees },
        status: 'ok',
      });
    }
  }

  const reorderParam = params.get('reorder');
  if (reorderParam) {
    for (const pair of reorderParam.split(',')) {
      const [fromStr, toStr] = pair.split(':');
      const fromPos = Number(fromStr);
      const newIdx = Number(toStr);
      if (!Number.isFinite(fromPos) || !Number.isFinite(newIdx)) continue;
      timeline.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId, sliceIdx: Math.floor(fromPos) },
        op: { kind: 'reorder', newIdx: Math.floor(newIdx) },
        status: 'ok',
      });
    }
  }

  const spacerWidth = numberParam('spacerWidth') ?? 5;
  const spacerSpecies = (params.get('spacerSpecies') ?? 'walnut') as Species;
  for (const afterSliceIdx of listParam('spacer')) {
    timeline.push({
      kind: 'spacerInsert',
      id: allocateId(counter, 'spacer'),
      arrangeId,
      afterSliceIdx,
      species: spacerSpecies,
      width: spacerWidth,
      status: 'ok',
    });
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

  function briefResult(r: FeatureResult | undefined): string {
    if (!r) return '';
    if ('slices' in r && Array.isArray((r as CutResult).slices)) {
      const cr = r as CutResult;
      return `${cr.slices.length} slices · ${cr.offcuts.length} offcuts`;
    }
    if ('panel' in r && (r as ArrangeResult | ComposeStripsResult).panel) {
      const pr = r as ArrangeResult | ComposeStripsResult;
      return `${pr.panel.volumes.length} vols`;
    }
    return '';
  }

  // ---- Single-pass pipeline run (guarded by manifold init) ----

  let output = $state<PipelineOutput | null>(null);

  onMount(() => {
    initManifold().then(() => {
      output = runPipeline(timeline, { preserveLive: true });
    });
  });

  // ---- Derived rendering ----

  const cutResult = $derived<CutResult | undefined>(
    output?.results['cut-0'] as CutResult | undefined,
  );
  const arrangeResult = $derived<ArrangeResult | undefined>(
    output?.results[arrangeId] as ArrangeResult | undefined,
  );
  const livePanel = $derived<Panel | undefined>(output?.livePanels?.[arrangeId]);

  const inputSvg = $derived.by(() => {
    if (!cutResult) return '';
    if (cutResult.slices.length === 0) return '';
    const SLICE_GAP = 15;
    const base = summarizeSlices(cutResult.slices, { gap: SLICE_GAP });
    const labels: string[] = [];
    cutResult.slices.forEach((slice, i) => {
      if (slice.volumes.length === 0) return;
      const dz = i * SLICE_GAP;
      const cx = (slice.bbox.min[0] + slice.bbox.max[0]) / 2;
      const cz = (slice.bbox.min[2] + slice.bbox.max[2]) / 2 + dz;
      labels.push(
        `<text x="${cx.toFixed(2)}" y="${cz.toFixed(2)}" ` +
          `font-family="system-ui, sans-serif" font-size="22" font-weight="700" ` +
          `text-anchor="middle" dominant-baseline="middle" ` +
          `fill="#1a1a1a" stroke="#fafaf7" stroke-width="4" paint-order="stroke" ` +
          `pointer-events="none">${i}</text>`,
      );
    });
    return base.replace('</svg>', `${labels.join('')}</svg>`);
  });

  const inputSubtitle = $derived(
    `cut-0 · ${cut ? `rip ${cut.rip}° · bevel ${cut.bevel}° · ${cut.slices} slices` : ''}`,
  );
  const inputMeta = $derived(
    cutResult ? `${cutResult.slices.length} slices feeding arrange` : '',
  );

  /** Edits and spacers actually applied to the arrange, including
   * preset expansions picked up from pipeline results. */
  const expandedEditsSpacers = $derived.by(() => {
    if (!output) return { edits: [], spacers: [] };
    const timelineEdits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
    const timelineSpacers = timeline.filter((f): f is SpacerInsert => f.kind === 'spacerInsert');
    const presetEdits: PlaceEdit[] = [];
    const presetSpacers: SpacerInsert[] = [];
    for (const f of timeline) {
      if (f.kind !== 'preset') continue;
      const r = output.results[f.id];
      if (!r) continue;
      if ('expandedPlaceEdits' in r) presetEdits.push(...r.expandedPlaceEdits);
      if ('expandedSpacers' in r) presetSpacers.push(...r.expandedSpacers);
    }
    return {
      edits: [...timelineEdits, ...presetEdits],
      spacers: [...timelineSpacers, ...presetSpacers],
    };
  });

  const opSvg = $derived.by(() => {
    if (!cutResult || !arrangeResult) return '';
    return renderArrangeOperation(
      cutResult,
      arrangeResult,
      expandedEditsSpacers.edits,
      expandedEditsSpacers.spacers,
    );
  });

  const opSubtitle = $derived.by(() => {
    const { edits, spacers } = expandedEditsSpacers;
    const editSummary = edits.length > 0 ? `${edits.length} edit${edits.length === 1 ? '' : 's'}` : 'no edits';
    const spacerSummary =
      spacers.length > 0 ? `${spacers.length} spacer${spacers.length === 1 ? '' : 's'}` : 'no spacers';
    return `${arrangeId} · cursor-slide · ${editSummary} · ${spacerSummary}`;
  });

  const opMeta = $derived.by(() => {
    if (!arrangeResult) return '';
    return arrangeResult.appliedEditCount > 0 || arrangeResult.appliedSpacerCount > 0
      ? `applied ${arrangeResult.appliedEditCount} edit${arrangeResult.appliedEditCount === 1 ? '' : 's'}, ` +
          `${arrangeResult.appliedSpacerCount} spacer${arrangeResult.appliedSpacerCount === 1 ? '' : 's'}`
      : 'identity arrange';
  });

  const outputMeta = $derived.by(() => {
    if (!arrangeResult) return '';
    const bb = arrangeResult.panel.bbox;
    const sx = (bb.max[0] - bb.min[0]).toFixed(0);
    const sy = (bb.max[1] - bb.min[1]).toFixed(0);
    const sz = (bb.max[2] - bb.min[2]).toFixed(0);
    return `${arrangeResult.panel.volumes.length} segments · ${sx}×${sy}×${sz} mm`;
  });

  const traceText = $derived.by(() => {
    if (!output) return 'trace pending';
    return output.trace
      .map((id) => {
        const r = output.results[id];
        const status = r?.status ?? '?';
        const extras = briefResult(r);
        return `${id} · ${status}${extras ? ' · ' + extras : ''}`;
      })
      .join('\n');
  });

  // ---- Viewport action ----
  function viewport(node: HTMLElement, panel: Panel) {
    let handle: ViewportHandle | null = null;
    function remount(p: Panel): void {
      handle?.dispose();
      handle = setupViewport(node, buildPanelGroup(p));
    }
    remount(panel);
    return {
      update(next: Panel): void { remount(next); },
      destroy(): void { handle?.dispose(); },
    };
  }
</script>

<main id="tiles">
  <article class="tile tile--2d" data-stage="cut-0" data-role="input">
    <header>
      <h2>Input</h2>
      <p class="subtitle">{inputSubtitle}</p>
    </header>
    <div class="render" data-slot="render">
      {#if inputSvg}
        {@html inputSvg}
      {:else if cutResult && cutResult.slices.length === 0}
        <div class="placeholder">no slices from upstream cut</div>
      {:else}
        <div class="placeholder">input pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{inputMeta}</div>
  </article>

  <article class="tile tile--2d" data-stage="arrange-0-op" data-role="operation">
    <header>
      <h2>Operation: Arrange</h2>
      <p class="subtitle">{opSubtitle}</p>
    </header>
    <div class="render" data-slot="render">
      {#if opSvg}
        {@html opSvg}
      {:else}
        <div class="placeholder">operation diagram pending</div>
      {/if}
    </div>
    <div class="meta" data-slot="meta">{opMeta}</div>
  </article>

  <article class="tile tile--3d" data-stage={arrangeId} data-role="output">
    <header>
      <h2>Output</h2>
      <p class="subtitle">reassembled panel · 3D viewport</p>
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
    <h2>Arrange harness</h2>
  </header>
  <div class="inspector-body">
    <section>
      <h3>URL parameters</h3>
      <div class="hint">Upstream Cut
  <code>?slices=4</code>   how many slices to feed in (default 4)
  <code>?rip=30</code>     rip angle in degrees (default 0)
  <code>?bevel=60</code>   bevel angle 45..90 (default 90)

Per-slice edits
  <code>?flip=1,3</code>   rotate 180° on these slice indices
  <code>?shift=1:25</code> shift slice 1 by 25 mm along X
                 (multiple: <code>?shift=1:25,3:-10</code>)
  <code>?rotate=1:37</code>  free-angle Y rotation (any degrees)
                 e.g. <code>?rotate=0:15,2:-25</code>
                 Caveat: mating breaks at non-90/180/270 angles —
                 the rotated slice's cut faces no longer lie on
                 the same plane family as its neighbours, so
                 there'll be visible gaps. Useful for exploration,
                 not for producing buildable panels.
  <code>?reorder=2:0</code>   move slice at current position 2 to
                 position 0. Chain with comma; each move is applied
                 in order so later moves see the already-reordered
                 sequence (like dragging slices one at a time).
                 Example: <code>?reorder=2:0,3:1</code>

Spacers (between slices)
  <code>?spacer=1</code>   insert a 5 mm walnut spacer
                 after slice 1 (multiple comma-separated)
  <code>?spacerWidth=10</code>  width in mm
  <code>?spacerSpecies=maple</code>  species

Presets (expand into edits/spacers at pipeline time)
  <code>?preset=flipAlternate</code>
  <code>?preset=rotateAlternate:90</code>   (90|180|270)
  <code>?preset=mirrorAlternate</code>
  <code>?preset=rotate4way</code>
  <code>?preset=shiftAlternate:25</code>    (shift mm)
  <code>?preset=spacerEveryRow:6</code>      (width mm)
  <code>?preset=spacerEveryRow:6:maple</code>
  Multiple: <code>?preset=flipAlternate,spacerEveryRow:5</code>

Example
  <code>?slices=4&amp;flip=1,3&amp;spacer=1</code>
  <code>?slices=8&amp;preset=flipAlternate</code>
  <code>?slices=8&amp;preset=rotate4way</code>
      </div>
    </section>
    <section>
      <h3>Pipeline trace</h3>
      <div data-slot="trace" class="hint">{traceText}</div>
    </section>
  </div>
</aside>

<style>
  .viewport-host {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
