<script lang="ts">
  /**
   * Svelte 5 port of main-compose.ts — focused harness for the
   * ComposeStrips operation.
   *
   * State shape (kept local to this harness, NOT persisted to URL):
   *   inventory: StripDef[]   — editable in Input tile
   *   order:     string[]     — stripIds in drag order
   *   stripHeight: number
   *   stripLength: number
   *
   * URL params are SEED ONLY. Edits in the tiles do not write back
   * to the URL.
   *
   * Snapshot-is-truth: the Output tile builds its 3D mesh from the
   * `livePanels['compose-0']` Panel surfaced under preserveLive.
   */

  import { onMount } from 'svelte';
  import { initManifold } from './domain/manifold';
  import { createIdCounter, allocateId } from './state/ids';
  import { runPipeline, type PipelineOutput } from './state/pipeline';
  import { buildPanelGroup } from './scene/meshBuilder';
  import { setupViewport, type ViewportHandle } from './scene/viewport';
  import type { Panel } from './domain/Panel';
  import type {
    ComposeStrips,
    ComposeStripsResult,
    Feature,
    Species,
    StripDef,
  } from './state/types';
  import StripInventory, { type InventoryState } from './ui/StripInventory.svelte';
  import StripReorder, { type ReorderState } from './ui/StripReorder.svelte';

  const counter = createIdCounter();
  // Seat compose-0 in the counter (there's only ever one ComposeStrips).
  allocateId(counter, 'compose');

  const params = new URLSearchParams(window.location.search);

  interface HarnessState {
    inventory: StripDef[];
    order: string[];
    stripHeight: number;
    stripLength: number;
  }

  function parseInitialState(): HarnessState {
    const SPECIES_SET: ReadonlySet<Species> = new Set<Species>([
      'maple', 'walnut', 'cherry', 'padauk', 'purpleheart',
    ]);

    const stripsParam = params.get('strips');
    let inventory: StripDef[];

    if (stripsParam) {
      inventory = [];
      for (const pair of stripsParam.split(',')) {
        const [spRaw, widthRaw] = pair.split(':');
        const sp = (spRaw ?? '').trim().toLowerCase();
        const width = Number(widthRaw);
        if (!SPECIES_SET.has(sp as Species)) continue;
        if (!Number.isFinite(width) || width <= 0) continue;
        inventory.push({
          stripId: allocateId(counter, 'strip'),
          species: sp as Species,
          width,
        });
      }
      if (inventory.length === 0) inventory = defaultInventory();
    } else {
      inventory = defaultInventory();
    }

    const orderParam = params.get('order');
    let order: string[];
    if (orderParam) {
      const idxs = orderParam
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n < inventory.length)
        .map((n) => Math.floor(n));
      const seen = new Set(idxs);
      if (idxs.length === inventory.length && seen.size === inventory.length) {
        order = idxs.map((i) => inventory[i].stripId);
      } else {
        order = inventory.map((s) => s.stripId);
      }
    } else {
      order = inventory.map((s) => s.stripId);
    }

    const stripHeight = positiveNumber(params.get('stripHeight'), 50);
    const stripLength = positiveNumber(params.get('stripLength'), 400);

    return { inventory, order, stripHeight, stripLength };
  }

  function defaultInventory(): StripDef[] {
    const out: StripDef[] = [];
    for (let i = 0; i < 7; i++) {
      out.push({ stripId: allocateId(counter, 'strip'), species: 'maple', width: 50 });
    }
    for (let i = 0; i < 7; i++) {
      out.push({ stripId: allocateId(counter, 'strip'), species: 'walnut', width: 50 });
    }
    return out;
  }

  function positiveNumber(raw: string | null, fallback: number): number {
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  const initial = parseInitialState();

  // ---- Reactive harness state ----
  let harnessState = $state<HarnessState>(initial);
  let output = $state<PipelineOutput | null>(null);
  let manifoldReady = $state(false);

  onMount(() => {
    initManifold().then(() => { manifoldReady = true; });
  });

  // Rerun pipeline whenever harness state changes.
  $effect(() => {
    if (!manifoldReady) return;
    const byId = new Map(harnessState.inventory.map((s) => [s.stripId, s]));
    const orderedStrips: StripDef[] = harnessState.order
      .map((id) => byId.get(id))
      .filter((s): s is StripDef => s !== undefined);

    const compose: ComposeStrips = {
      kind: 'composeStrips',
      id: 'compose-0',
      strips: orderedStrips,
      stripHeight: harnessState.stripHeight,
      stripLength: harnessState.stripLength,
      status: 'ok',
    };
    const timeline: Feature[] = [compose];
    output = runPipeline(timeline, { preserveLive: true });
  });

  // ---- Child component props ----
  const inventoryState: InventoryState = $derived({
    inventory: harnessState.inventory,
    order: harnessState.order,
    stripHeight: harnessState.stripHeight,
    stripLength: harnessState.stripLength,
  });

  const reorderState: ReorderState = $derived({
    inventory: harnessState.inventory,
    order: harnessState.order,
    stripLength: harnessState.stripLength,
  });

  function onInventoryChange(next: InventoryState): void {
    harnessState = {
      inventory: next.inventory,
      order: next.order,
      stripHeight: next.stripHeight,
      stripLength: next.stripLength,
    };
  }

  function onReorderChange(nextOrder: string[]): void {
    harnessState = { ...harnessState, order: nextOrder };
  }

  // ---- Derived renderings ----
  const composeResult = $derived<ComposeStripsResult | undefined>(
    output?.results['compose-0'] as ComposeStripsResult | undefined,
  );
  const livePanel = $derived<Panel | undefined>(output?.livePanels?.['compose-0']);

  const orderedStrips: StripDef[] = $derived.by(() => {
    const byId = new Map(harnessState.inventory.map((s) => [s.stripId, s]));
    return harnessState.order
      .map((id) => byId.get(id))
      .filter((s): s is StripDef => s !== undefined);
  });

  const inputSubtitle = $derived(
    `compose-0 · ${harnessState.inventory.length} strips in inventory`,
  );
  const inputMeta = $derived(`inventory: ${formatSpeciesTally(harnessState.inventory)}`);

  const opSubtitle = $derived(`compose-0 · ${harnessState.order.length} strips arranged`);
  const opMeta = $derived(`arrangement: ${formatOrderTally(orderedStrips)}`);

  const bboxDims = $derived.by(() => {
    if (!composeResult) return null;
    const bb = composeResult.panel.bbox;
    return {
      sx: (bb.max[0] - bb.min[0]).toFixed(0),
      sy: (bb.max[1] - bb.min[1]).toFixed(0),
      sz: (bb.max[2] - bb.min[2]).toFixed(0),
    };
  });

  const outputSubtitle = $derived.by(() => {
    if (!bboxDims) return 'composed panel · 3D viewport';
    return `compose-0 · panel ${bboxDims.sx}×${bboxDims.sy}×${bboxDims.sz} mm`;
  });

  const outputMeta = $derived.by(() => {
    if (!composeResult || !bboxDims) return '';
    return `${composeResult.panel.volumes.length} volumes · total width ${bboxDims.sx} mm`;
  });

  const stateSummary = $derived.by(() => {
    if (!bboxDims) return 'summary pending';
    return (
      `thickness  ${harnessState.stripHeight} mm\n` +
      `length     ${harnessState.stripLength} mm\n` +
      `inventory  ${harnessState.inventory.length} strips\n` +
      `arranged   ${harnessState.order.length} strips\n` +
      `panel      ${bboxDims.sx} × ${bboxDims.sy} × ${bboxDims.sz} mm`
    );
  });

  const traceText = $derived.by(() => {
    if (!output) return 'trace pending';
    return output.trace
      .map((id) => {
        const r = output.results[id];
        const status = r?.status ?? '?';
        return `${id} · ${status} · ${(r as ComposeStripsResult)?.panel?.volumes?.length ?? 0} vols`;
      })
      .join('\n');
  });

  // ---- Viewport action ----
  function viewport(node: HTMLElement, panel: Panel) {
    let handle: ViewportHandle | null = null;
    function remount(p: Panel): void {
      handle?.dispose();
      handle = setupViewport(node, buildPanelGroup(p), { vertical: 'x' });
    }
    remount(panel);
    return {
      update(next: Panel): void { remount(next); },
      destroy(): void { handle?.dispose(); },
    };
  }

  function allocateStripIdFn(): string {
    return allocateId(counter, 'strip');
  }

  function formatSpeciesTally(strips: StripDef[]): string {
    const tally = new Map<string, number>();
    for (const s of strips) tally.set(s.species, (tally.get(s.species) ?? 0) + 1);
    return Array.from(tally.entries()).map(([sp, n]) => `${n} ${sp}`).join(' · ');
  }

  function formatOrderTally(strips: StripDef[]): string {
    const MAX = 8;
    const shown = strips.slice(0, MAX).map((s) => `${s.species}(${s.width})`);
    const tail = strips.length > MAX ? ` +${strips.length - MAX} more` : '';
    return shown.join(' · ') + tail;
  }
</script>

<main id="tiles">
  <article class="tile tile--interactive" data-stage="compose-0-input" data-role="input">
    <header>
      <h2>Input</h2>
      <p class="subtitle">{inputSubtitle}</p>
    </header>
    <div class="render" data-slot="render">
      <StripInventory
        state={inventoryState}
        allocateStripId={allocateStripIdFn}
        onChange={onInventoryChange}
      />
    </div>
    <div class="meta" data-slot="meta">{inputMeta}</div>
  </article>

  <article class="tile tile--2d" data-stage="compose-0-op" data-role="operation">
    <header>
      <h2>Operation: ComposeStrips</h2>
      <p class="subtitle">{opSubtitle}</p>
    </header>
    <div class="render" data-slot="render">
      <StripReorder value={reorderState} onChange={onReorderChange} />
    </div>
    <div class="meta" data-slot="meta">{opMeta}</div>
  </article>

  <article class="tile tile--3d" data-stage="compose-0" data-role="output">
    <header>
      <h2>Output</h2>
      <p class="subtitle">{outputSubtitle}</p>
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
    <h2>ComposeStrips harness</h2>
  </header>
  <div class="inspector-body">
    <section>
      <h3>URL parameters (seed only)</h3>
      <div class="hint">Edits in tiles do NOT sync to the URL.
Refresh to return to the seed state.

<code>?strips=maple:50,walnut:50,maple:50,...</code>
  Comma-separated <code>species:width(mm)</code> pairs.
  Defines the inventory. Species must be one of
  <code>maple</code>, <code>walnut</code>, <code>cherry</code>,
  <code>padauk</code>, <code>purpleheart</code>.

<code>?order=3,1,0,2,...</code>
  Indices into the inventory — defines the
  arrangement. Optional; defaults to <code>[0,1,2,...]</code>.

<code>?stripHeight=50</code>
  Global thickness in mm (default 50).

<code>?stripLength=400</code>
  Global length in mm (default 400).

Default seed (no params)
  14 strips: 7 maple + 7 walnut, 50 mm wide.
  Thickness 50 mm, length 400 mm.

Examples
  3-strip preview:
    <code>?strips=cherry:30,padauk:40,purpleheart:20</code>
  Reversed arrangement:
    <code>?order=13,12,11,10,9,8,7,6,5,4,3,2,1,0</code>
  Thin panel for end-grain preview:
    <code>?stripHeight=20&amp;stripLength=300</code>
      </div>
    </section>
    <section>
      <h3>Current state</h3>
      <div data-slot="state-summary" class="hint">{stateSummary}</div>
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
