<script lang="ts">
  /**
   * Svelte 5 port of main-workbench.ts — the integrated canvas.
   *
   * Layout: timeline ribbon (left) | hero 3D (top) | pipeline
   * stages (below). At most 2 WebGL viewports active at once —
   * hero + at-most-one focused stage. If the focused stage is the
   * last main op (Trim), the hero IS that stage's output so we
   * skip the duplicate.
   *
   * Focus toggle lives ONLY on the stage <header>, not on anything
   * inside the body — so button clicks etc. don't defocus.
   *
   * Shared camera: a single CameraState $state bound to every
   * SyncedViewport, so tumbling any one updates the others and
   * pipeline reruns preserve orientation.
   */

  import { onMount } from 'svelte';
  import { Group } from 'three';

  import { initManifold } from './domain/manifold';
  import {
    allocateId,
    createIdCounter,
    type IdCounter,
    type IdPrefix,
  } from './state/ids';
  import { runPipeline, type PipelineOutput } from './state/pipeline';
  import { buildPanelGroup } from './scene/meshBuilder';
  import type { Panel } from './domain/Panel';
  import type { CameraState } from './scene/viewport';
  import {
    renderCutOperation,
    renderArrangeOperation,
    renderTrimOperation,
  } from './render/operations';
  import SyncedViewport from './SyncedViewport.svelte';
  import StripInventory, {
    type InventoryState,
  } from './ui/StripInventory.svelte';
  import StripReorder, { type ReorderState } from './ui/StripReorder.svelte';
  import CutControls, { type CutControlsState } from './ui/CutControls.svelte';
  import TrimControls, { type TrimControlsState } from './ui/TrimControls.svelte';
  import ArrangeControls from './ui/ArrangeControls.svelte';
  import ArrangePreview from './ui/ArrangePreview.svelte';
  import {
    handleArrangeKey as sharedHandleArrangeKey,
    reorderSlice as sharedReorderSlice,
    type ArrangeActionContext,
  } from './state/arrangeActions';
  import type {
    Arrange,
    ArrangeResult,
    ComposeStrips,
    Cut,
    CutResult,
    Feature,
    PanelSnapshot,
    PlaceEdit,
    SpacerInsert,
    StripDef,
    TrimPanel,
    TrimPanelResult,
  } from './state/types';
  import {
    OP_SIGNATURES,
    extractPanel,
    extractSlices,
    type IOKind,
  } from './state/opSignatures';

  // ---- Persistence constants + URL ----
  const SAVE_PREFIX = 'end-grain:workbench:';

  interface StoredDesign {
    version: 1;
    timeline: Feature[];
    savedAt: number;
  }

  function sanitizeDesignName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function loadDesign(designName: string): StoredDesign | null {
    const raw = localStorage.getItem(SAVE_PREFIX + designName);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredDesign;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.timeline)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function defaultWorkbenchTimeline(counter: IdCounter): Feature[] {
    const strips: StripDef[] = [
      { stripId: allocateId(counter, 'strip'), species: 'maple', width: 50 },
      { stripId: allocateId(counter, 'strip'), species: 'walnut', width: 50 },
      { stripId: allocateId(counter, 'strip'), species: 'maple', width: 50 },
      { stripId: allocateId(counter, 'strip'), species: 'walnut', width: 50 },
    ];
    const compose: ComposeStrips = {
      kind: 'composeStrips',
      id: 'compose-0',
      strips,
      stripHeight: 50,
      stripLength: 400,
      status: 'ok',
    };
    allocateId(counter, 'compose'); // seat the compose counter

    const cut: Cut = {
      kind: 'cut',
      id: allocateId(counter, 'cut'),
      orientation: 0,
      rip: 0,
      bevel: 90,
      spacingMode: 'slices',
      pitch: 50,
      slices: 4,
      showOffcuts: false,
      status: 'ok',
    };
    const arrange: Arrange = {
      kind: 'arrange',
      id: allocateId(counter, 'arrange'),
      layout: 'cursor-slide',
      status: 'ok',
    };
    const trim: TrimPanel = {
      kind: 'trimPanel',
      id: allocateId(counter, 'trim' as IdPrefix),
      mode: 'flush',
      status: 'ok',
    };
    return [compose, cut, arrange, trim];
  }

  function counterFromTimeline(timeline: Feature[]): IdCounter {
    const counter = createIdCounter();
    const record = (id: string) => {
      const m = id.match(/^([a-z]+)-(\d+)$/);
      if (!m) return;
      const [, p, n] = m;
      const num = Number(n);
      counter.next[p] = Math.max(counter.next[p] ?? 0, num + 1);
    };
    for (const f of timeline) {
      record(f.id);
      if (f.kind === 'composeStrips') {
        for (const s of f.strips) record(s.stripId);
      }
    }
    return counter;
  }

  // ---- Initial state ----
  const urlParams = new URLSearchParams(window.location.search);
  const rawName = urlParams.get('design') ? sanitizeDesignName(urlParams.get('design')!) : '';
  const initialDesignName = rawName || 'untitled';

  let idCounter: IdCounter;
  let initialTimeline: Feature[];
  {
    const stored = loadDesign(initialDesignName);
    if (stored) {
      initialTimeline = stored.timeline;
      idCounter = counterFromTimeline(stored.timeline);
    } else {
      idCounter = createIdCounter();
      initialTimeline = defaultWorkbenchTimeline(idCounter);
    }
  }

  // ---- Reactive state ----
  let designName = $state(initialDesignName);
  let timeline = $state<Feature[]>(initialTimeline);
  let focusedStageId = $state<string | null>(null);
  /**
   * Arrange slice selection — scoped per Arrange stage so that two
   * Arranges in the timeline don't share state. Each entry carries
   * the selection Set and the shift-click anchor. Reassign the Map
   * (not mutate) when writing, so Svelte 5 reactivity fires.
   */
  interface ArrangeSelectionEntry {
    selection: Set<number>;
    anchor: number | null;
  }
  let selectionByArrange = $state<Map<string, ArrangeSelectionEntry>>(new Map());

  function getArrangeSelection(arrangeId: string): ArrangeSelectionEntry {
    return (
      selectionByArrange.get(arrangeId) ?? { selection: new Set(), anchor: null }
    );
  }

  function setArrangeSelection(
    arrangeId: string,
    selection: Set<number>,
    anchor: number | null,
  ): void {
    const next = new Map(selectionByArrange);
    next.set(arrangeId, { selection, anchor });
    selectionByArrange = next;
  }
  /** DOM refs to each stage <article> so we can programmatically
   *  focus the Arrange stage when it becomes focused — keyboard
   *  actions (F, R, E, O, ...) listen on the article. */
  const stageRefs: Record<string, HTMLElement | null> = {};
  let saveStatus = $state<'saving' | 'saved' | 'idle'>('idle');
  let manifoldReady = $state(false);
  let output = $state<PipelineOutput | null>(null);
  let sharedCamera = $state<CameraState | null>(null);
  /** Bump to force a pipeline rerun when in-place mutations occur. */
  let tick = $state(0);

  // Seed URL from design name on first load.
  syncUrlToDesignName(designName);

  function syncUrlToDesignName(name: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('design', name);
    window.history.replaceState(null, '', url);
  }

  onMount(() => {
    initManifold().then(() => {
      manifoldReady = true;
    });
  });

  // ---- Pipeline effect ----
  $effect(() => {
    void tick;
    void timeline;
    if (!manifoldReady) return;
    output = runPipeline(timeline, { preserveLive: true });
  });

  function rerun(): void {
    tick += 1;
  }

  // ---- Autosave ----
  let saveTimer: number | null = null;
  $effect(() => {
    void tick;
    void timeline;
    void designName;
    if (!manifoldReady) return;
    saveStatus = 'saving';
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    const snapshotName = designName;
    const snapshotTimeline = timeline;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const payload: StoredDesign = {
        version: 1,
        timeline: snapshotTimeline,
        savedAt: Date.now(),
      };
      localStorage.setItem(SAVE_PREFIX + snapshotName, JSON.stringify(payload));
      saveStatus = 'saved';
    }, 300);
  });

  // ---- Design rename ----
  function onDesignNameChange(raw: string): void {
    const next = sanitizeDesignName(raw) || 'untitled';
    if (next === designName) return;
    const oldKey = SAVE_PREFIX + designName;
    const newKey = SAVE_PREFIX + next;
    const existing = localStorage.getItem(oldKey);
    if (existing !== null) {
      localStorage.setItem(newKey, existing);
      localStorage.removeItem(oldKey);
    }
    designName = next;
    syncUrlToDesignName(next);
  }

  // ---- Main op + feature lookup ----
  type MainOp = ComposeStrips | Cut | Arrange | TrimPanel;

  const mainOps: MainOp[] = $derived(
    timeline.filter(
      (f): f is MainOp =>
        f.kind === 'composeStrips' ||
        f.kind === 'cut' ||
        f.kind === 'arrange' ||
        f.kind === 'trimPanel',
    ),
  );

  const lastMainOp: MainOp | null = $derived(
    mainOps.length > 0 ? mainOps[mainOps.length - 1] : null,
  );

  function labelFor(f: Feature): string {
    switch (f.kind) {
      case 'composeStrips': return 'Compose';
      case 'cut': return 'Cut';
      case 'arrange': return 'Arrange';
      case 'trimPanel': return 'Trim';
      default: return f.kind;
    }
  }

  // ---- Ribbon subtitle helper ----
  function subForFeature(f: Feature, out: PipelineOutput | null): string {
    if (!out) return '';
    switch (f.kind) {
      case 'composeStrips': {
        const total = f.strips.reduce((n, s) => n + s.width, 0);
        return `${f.strips.length} strips · ${total} mm`;
      }
      case 'cut': {
        const r = out.results[f.id] as CutResult | undefined;
        const dense = f.spacingMode === 'slices' ? `${f.slices} slices` : `pitch ${f.pitch}`;
        return `${dense} · rip ${f.rip}°` + (r ? ` · ${r.slices.length} out` : '');
      }
      case 'arrange': {
        const r = out.results[f.id] as ArrangeResult | undefined;
        return r ? `${r.appliedEditCount} edits` : '';
      }
      case 'trimPanel': {
        const r = out.results[f.id] as TrimPanelResult | undefined;
        if (!r) return f.mode;
        const w = (r.appliedBounds.xMax - r.appliedBounds.xMin).toFixed(0);
        const l = (r.appliedBounds.zMax - r.appliedBounds.zMin).toFixed(0);
        return `${f.mode} · ${w}×${l}`;
      }
      default:
        return '';
    }
  }

  // ---- Hero ----
  const heroLive: Panel | null = $derived.by(() => {
    if (!output || !lastMainOp) return null;
    const live = output.livePanels?.[lastMainOp.id];
    if (live) return live;
    // Fallback: last successful panel.
    for (let i = output.trace.length - 1; i >= 0; i--) {
      const id = output.trace[i];
      const p = output.livePanels?.[id];
      if (p) return p;
    }
    return null;
  });

  const heroLiveId: string | null = $derived.by(() => {
    if (!output || !lastMainOp) return null;
    if (output.livePanels?.[lastMainOp.id]) return lastMainOp.id;
    for (let i = output.trace.length - 1; i >= 0; i--) {
      const id = output.trace[i];
      if (output.livePanels?.[id]) return id;
    }
    return null;
  });

  const heroGroup: Group | null = $derived(
    heroLive ? buildPanelGroup(heroLive) : null,
  );

  const heroSubText: string = $derived.by(() => {
    if (!heroLive) return 'pipeline produced no live panel';
    if (heroLiveId && lastMainOp && heroLiveId !== lastMainOp.id) {
      return `fallback from ${heroLiveId}`;
    }
    if (!heroLive || !lastMainOp) return '';
    const bb = heroLive.boundingBox();
    const x = (bb.max.x - bb.min.x).toFixed(0);
    const y = (bb.max.y - bb.min.y).toFixed(0);
    const z = (bb.max.z - bb.min.z).toFixed(0);
    return `${x}×${y}×${z} mm · after ${labelFor(lastMainOp)}`;
  });

  // ---- Focused stage 3D ----
  /** Returns the Three Group for the focused stage, or null if there
   *  shouldn't be one (not focused, or focused is the last op so hero
   *  covers it). */
  const focusedGroup: Group | null = $derived.by(() => {
    if (!focusedStageId || !output) return null;
    if (lastMainOp && focusedStageId === lastMainOp.id) return null;
    const focused = mainOps.find((f) => f.id === focusedStageId);
    if (!focused) return null;
    if (focused.kind === 'cut') {
      const slices = output.liveCutSlices?.[focused.id] ?? [];
      if (slices.length === 0) return null;
      return buildSlicesGroup(slices);
    }
    const live = output.livePanels?.[focused.id];
    if (!live) return null;
    return buildPanelGroup(live);
  });

  function buildSlicesGroup(slices: Panel[]): Group {
    const group = new Group();
    if (slices.length === 0) return group;
    const firstBB = slices[0].boundingBox();
    const gap = firstBB.max.y - firstBB.min.y;
    const centerIdx = (slices.length - 1) / 2;
    slices.forEach((slice, i) => {
      const g = buildPanelGroup(slice);
      g.position.z = (i - centerIdx) * gap;
      group.add(g);
    });
    return group;
  }

  // ---- Per-stage mutations (invoked from child controls) ----

  function applyComposeInventory(feature: ComposeStrips, next: InventoryState): void {
    feature.stripHeight = next.stripHeight;
    feature.stripLength = next.stripLength;
    const byId = new Map(next.inventory.map((s) => [s.stripId, s]));
    feature.strips = next.order
      .map((id) => byId.get(id))
      .filter((s): s is StripDef => s !== undefined);
    rerun();
  }

  function applyComposeReorder(feature: ComposeStrips, nextOrder: string[]): void {
    const byId = new Map(feature.strips.map((s) => [s.stripId, s]));
    feature.strips = nextOrder
      .map((id) => byId.get(id))
      .filter((s): s is StripDef => s !== undefined);
    rerun();
  }

  function applyCutControls(feature: Cut, next: CutControlsState): void {
    feature.orientation = next.orientation;
    feature.rip = next.rip;
    feature.bevel = next.bevel;
    feature.spacingMode = next.spacingMode;
    feature.pitch = next.pitch;
    feature.slices = next.slices;
    feature.showOffcuts = next.showOffcuts;
    rerun();
  }

  function applyTrimControls(feature: TrimPanel, next: TrimControlsState): void {
    feature.mode = next.mode;
    if (next.bounds === undefined) delete feature.bounds;
    else feature.bounds = { ...next.bounds };
    rerun();
  }

  /**
   * Append a Cut + Arrange pair to the timeline, inserted before the
   * terminal Trim (or at the end if no Trim exists). Every Cut needs a
   * following Arrange to make its slices into a panel again, so the
   * pair is the atomic unit the timeline UI adds.
   *
   * The new Cut inherits orientation=0 and the same default knobs as
   * the seeded first Cut; the user toggles orientation=90 to get the
   * perpendicular re-cut behaviour.
   */
  function addCutAndArrange(): void {
    const newCut: Cut = {
      kind: 'cut',
      id: allocateId(idCounter, 'cut'),
      orientation: 0,
      rip: 0,
      bevel: 90,
      spacingMode: 'slices',
      pitch: 50,
      slices: 4,
      showOffcuts: false,
      status: 'ok',
    };
    const newArrange: Arrange = {
      kind: 'arrange',
      id: allocateId(idCounter, 'arrange'),
      layout: 'cursor-slide',
      status: 'ok',
    };
    const trimIdx = timeline.findIndex((f) => f.kind === 'trimPanel');
    if (trimIdx === -1) {
      timeline = [...timeline, newCut, newArrange];
    } else {
      timeline = [
        ...timeline.slice(0, trimIdx),
        newCut,
        newArrange,
        ...timeline.slice(trimIdx),
      ];
    }
    focusedStageId = newCut.id;
    rerun();
  }

  /** Replace the PlaceEdits targeting an Arrange, keeping its
   *  attached spacers untouched (they flow through unmodified). */
  function applyArrangeEdits(feature: Arrange, nextEdits: PlaceEdit[]): void {
    const filtered = timeline.filter(
      (f) => !(f.kind === 'placeEdit' && f.target.arrangeId === feature.id),
    );
    timeline = [...filtered, ...nextEdits];
  }

  /** Build the shared ArrangeActionContext for a given Arrange. Bridges
   *  the workbench's selection-by-arrangeId map, editsFor / applyArrangeEdits
   *  helpers, and id counter into the shape arrangeActions.ts expects. */
  function buildArrangeContext(feature: Arrange): ArrangeActionContext {
    const sel = getArrangeSelection(feature.id);
    return {
      arrangeId: feature.id,
      sliceCount: upstreamOutputFor(feature.id, 'slices')?.length ?? 0,
      selection: { set: sel.selection, anchor: sel.anchor },
      edits: editsFor(feature.id),
      setSelection: (set, anchor) => setArrangeSelection(feature.id, set, anchor),
      setEdits: (next) => applyArrangeEdits(feature, next),
      allocateEditId: () => allocateId(idCounter, 'edit'),
    };
  }

  /** Keyboard handler on the Arrange stage's <article>. Routes through
   *  the shared arrangeActions module so the harness gets the same
   *  bindings without code duplication. */
  function handleArrangeKey(feature: Arrange, e: KeyboardEvent): void {
    if (sharedHandleArrangeKey(buildArrangeContext(feature), e)) {
      e.preventDefault();
    }
  }

  /** Append a reorder edit from a drag-and-drop on the ArrangePreview.
   *  `fromPos` / `toPos` are positions in the currently-rendered
   *  slice order, matching the pipeline's reorderSequence semantics. */
  function reorderArrangeSlice(
    feature: Arrange,
    fromPos: number,
    toPos: number,
  ): void {
    sharedReorderSlice(buildArrangeContext(feature), fromPos, toPos);
  }

  function allocateIdFn(prefix: IdPrefix): string {
    return allocateId(idCounter, prefix);
  }

  function allocateStripId(): string {
    return allocateId(idCounter, 'strip');
  }

  // ---- Upstream lookup — typed by I/O kind ----
  /**
   * Walk the mainOps backward from `featureId`, returning the
   * extracted payload of the most recent upstream producer whose
   * output matches `want`. See state/opSignatures.ts for the
   * registry that drives the search.
   *
   * Call sites read this instead of hardcoding stage ids, so the
   * renderer naturally follows the pipeline's topology — a Cut
   * after a Trim resolves Trim's panel the same way a Cut after
   * Compose resolves Compose's panel, no code change needed.
   */
  function upstreamOutputFor(featureId: string, want: 'panel'): PanelSnapshot | undefined;
  function upstreamOutputFor(featureId: string, want: 'slices'): PanelSnapshot[] | undefined;
  function upstreamOutputFor(featureId: string, want: IOKind) {
    const idx = mainOps.findIndex((f) => f.id === featureId);
    for (let i = idx - 1; i >= 0; i--) {
      const up = mainOps[i];
      const sig = OP_SIGNATURES[up.kind];
      if (sig?.output !== want) continue;
      const r = output?.results[up.id];
      if (!r) continue;
      return want === 'panel' ? extractPanel(r) : extractSlices(r);
    }
    return undefined;
  }

  /**
   * Sibling helper — returns the upstream producer's feature id
   * rather than its payload. Used by ArrangePreview to match slice
   * provenance ids to the paired Cut.
   */
  function upstreamFeatureIdFor(
    featureId: string,
    want: IOKind,
  ): string | undefined {
    const idx = mainOps.findIndex((f) => f.id === featureId);
    for (let i = idx - 1; i >= 0; i--) {
      if (OP_SIGNATURES[mainOps[i].kind]?.output === want) return mainOps[i].id;
    }
    return undefined;
  }

  function editsFor(arrangeId: string): PlaceEdit[] {
    return timeline.filter(
      (f): f is PlaceEdit => f.kind === 'placeEdit' && f.target.arrangeId === arrangeId,
    );
  }
  function spacersFor(arrangeId: string): SpacerInsert[] {
    return timeline.filter(
      (f): f is SpacerInsert => f.kind === 'spacerInsert' && f.arrangeId === arrangeId,
    );
  }

  // Click-handler wired to <header> only — keeps focus toggle clear
  // of body-side interactions.
  function toggleFocus(id: string): void {
    focusedStageId = focusedStageId === id ? null : id;
    // Selection lives in `selectionByArrange`, keyed per Arrange id,
    // so it persists naturally when focus moves and doesn't bleed
    // across stages.
    // Move DOM keyboard focus into the focused stage's <article>
    // so keydown handlers (Arrange) receive events right away.
    if (focusedStageId) {
      const id2 = focusedStageId;
      queueMicrotask(() => stageRefs[id2]?.focus({ preventScroll: true }));
    }
  }

  function warnInlineText(featureId: string): string {
    if (!output) return '';
    const r = output.results[featureId];
    if (r && r.status !== 'ok' && r.statusReason) {
      return `· ${r.status}: ${r.statusReason}`;
    }
    return '';
  }

  function stageStatusClass(featureId: string): string {
    if (!output) return '';
    const r = output.results[featureId];
    if (!r) return '';
    if (r.status === 'warning') return 'warn';
    if (r.status === 'error') return 'err';
    return '';
  }
</script>

<header class="wb-header">
  <h1>End-grain — Workbench</h1>
  <input
    class="design-name"
    data-slot="design-name"
    spellcheck="false"
    placeholder="untitled"
    value={designName}
    onchange={(e) => onDesignNameChange((e.currentTarget as HTMLInputElement).value)}
    onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
  />
  <span
    class="save-status"
    class:saving={saveStatus === 'saving'}
    class:saved={saveStatus === 'saved'}
  >
    {saveStatus === 'saving' ? 'saving…' : saveStatus === 'saved' ? 'saved' : ''}
  </span>
  <nav>
    <a href="./cutting-board-workbench-designs.html">Designs →</a>
    <a href="./index.html">← Harnesses</a>
  </nav>
</header>

<div class="shell">
  <aside class="timeline">
    <header><h2>Timeline</h2></header>
    <div class="body">
      {#each mainOps as f, i (f.id)}
        {#if i > 0}<div class="t-connector"></div>{/if}
        <div
          class="t-item {stageStatusClass(f.id)}"
          class:active={focusedStageId === f.id}
          onclick={() => toggleFocus(f.id)}
          role="button"
          tabindex="0"
        >
          <span class="op">{labelFor(f)}</span>
          <span class="sub">{subForFeature(f, output)}</span>
        </div>
      {/each}
      <div class="t-connector"></div>
      <button
        type="button"
        class="t-add"
        onclick={addCutAndArrange}
        title="Insert a new Cut + Arrange pair before the Trim"
      >+ Cut</button>
    </div>
  </aside>

  <main class="main">
    <section class="hero">
      <span class="hero-label">Final panel</span>
      <span class="hero-sub">{heroSubText}</span>
      <div class="hero-viewport">
        {#if heroGroup}
          <SyncedViewport group={heroGroup} bind:camera={sharedCamera} mode="3d-final" />
        {/if}
      </div>
    </section>

    <div class="pipeline-wrap">
      <div class="pipeline-head">
        <h2>Pipeline</h2>
        <span class="hint">click a stage to focus · focused stage shows 3D</span>
      </div>
      <div class="pipeline">
        {#each mainOps as feature, i (feature.id)}
          {#if i > 0}<div class="flow">↓</div>{/if}
          {@const isFocused = focusedStageId === feature.id}
          {@const isLastOp = lastMainOp?.id === feature.id}
          <article
            bind:this={stageRefs[feature.id]}
            class="stage {stageStatusClass(feature.id)}"
            class:focused={isFocused}
            tabindex={feature.kind === 'arrange' && isFocused ? 0 : -1}
            onkeydown={feature.kind === 'arrange'
              ? (e) => handleArrangeKey(feature, e)
              : null}
          >
            <header
              class="stage-header"
              onclick={() => toggleFocus(feature.id)}
              role="button"
              tabindex="0"
            >
              <h3>{labelFor(feature)}</h3>
              <span class="sub">{subForFeature(feature, output)}</span>
              <span class="warn-inline">{warnInlineText(feature.id)}</span>
              <span class="spacer"></span>
              {#if isFocused}<span class="badge">focused</span>{/if}
            </header>
            <div class="stage-body">
              <section class="panel controls p-ctrl">
                <div class="p-head">Controls</div>
                <div class="p-body">
                  {#if feature.kind === 'composeStrips'}
                    <div class="compose-inventory-wrap">
                      <StripInventory
                        state={{
                          inventory: feature.strips,
                          order: feature.strips.map((s) => s.stripId),
                          stripHeight: feature.stripHeight,
                          stripLength: feature.stripLength,
                        }}
                        allocateStripId={allocateStripId}
                        onChange={(next) => applyComposeInventory(feature, next)}
                      />
                    </div>
                  {:else if feature.kind === 'cut'}
                    <CutControls
                      state={{
                        orientation: feature.orientation,
                        rip: feature.rip,
                        bevel: feature.bevel,
                        spacingMode: feature.spacingMode,
                        pitch: feature.pitch,
                        slices: feature.slices,
                        showOffcuts: feature.showOffcuts,
                      }}
                      onChange={(next) => applyCutControls(feature, next)}
                    />
                  {:else if feature.kind === 'arrange'}
                    {@const upSlices = upstreamOutputFor(feature.id, 'slices') ?? []}
                    {@const sel = getArrangeSelection(feature.id)}
                    <ArrangeControls
                      value={{
                        arrangeId: feature.id,
                        upstreamSlices: upSlices,
                        edits: editsFor(feature.id),
                        selection: { set: sel.selection, anchor: sel.anchor },
                      }}
                      onSelectionChange={(ev) =>
                        setArrangeSelection(feature.id, ev.set, ev.anchor)
                      }
                      onEditsChange={(next) => applyArrangeEdits(feature, next)}
                      allocateEditId={() => allocateId(idCounter, 'edit')}
                    />
                  {:else if feature.kind === 'trimPanel'}
                    <TrimControls
                      state={{
                        mode: feature.mode,
                        bounds: feature.bounds ? { ...feature.bounds } : undefined,
                      }}
                      onChange={(next) => applyTrimControls(feature, next)}
                    />
                  {/if}
                </div>
              </section>

              <section class="panel p-preview">
                <div class="p-head">Preview</div>
                <div class="p-body preview-body">
                  {#if feature.kind === 'composeStrips'}
                    <StripReorder
                      value={{
                        inventory: feature.strips,
                        order: feature.strips.map((s) => s.stripId),
                        stripLength: feature.stripLength,
                      }}
                      onChange={(nextOrder) => applyComposeReorder(feature, nextOrder)}
                    />
                  {:else if feature.kind === 'cut'}
                    {@const cr = output?.results[feature.id] as CutResult | undefined}
                    {#if cr}
                      {@html renderCutOperation(cr)}
                    {/if}
                  {:else if feature.kind === 'arrange'}
                    {@const ar = output?.results[feature.id] as ArrangeResult | undefined}
                    {@const aSel = getArrangeSelection(feature.id)}
                    {@const pairedCutId = upstreamFeatureIdFor(feature.id, 'slices')}
                    {#if ar}
                      <ArrangePreview
                        value={{
                          arrangeResult: ar,
                          cutId: pairedCutId,
                          spacers: spacersFor(feature.id),
                          selection: aSel.selection,
                        }}
                        anchor={aSel.anchor}
                        onSelectionChange={(ev) => {
                          setArrangeSelection(feature.id, ev.selection, ev.anchor);
                        }}
                        onReorder={(ev) =>
                          reorderArrangeSlice(feature, ev.fromPos, ev.toPos)
                        }
                      />
                    {/if}
                  {:else if feature.kind === 'trimPanel'}
                    {@const tr = output?.results[feature.id] as TrimPanelResult | undefined}
                    {@const inp = upstreamOutputFor(feature.id, 'panel')}
                    {#if inp && tr}
                      {@html renderTrimOperation(inp, tr)}
                    {/if}
                  {/if}
                </div>
              </section>

              {#if isFocused && !isLastOp && focusedGroup}
                <section class="panel view-3d p-3d">
                  <div class="p-head">3D · post-{labelFor(feature)}</div>
                  <div class="p-body">
                    <SyncedViewport
                      group={focusedGroup}
                      bind:camera={sharedCamera}
                      mode="3d-active"
                    />
                  </div>
                </section>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </div>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
  }
  .wb-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e4e4e0;
    background: #fff;
  }
  .wb-header h1 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .wb-header .design-name {
    font: inherit;
    font-size: 0.9rem;
    border: 1px solid #d6d4cf;
    border-radius: 4px;
    padding: 2px 6px;
    background: #fafaf7;
    width: 220px;
  }
  .wb-header .save-status {
    font-size: 0.75rem;
    color: #999;
  }
  .wb-header .save-status.saving { color: #888; }
  .wb-header .save-status.saved { color: #6a8a44; }
  .wb-header nav {
    margin-left: auto;
    font-size: 0.8rem;
  }
  .wb-header nav a {
    color: #666;
    text-decoration: none;
    margin-left: 0.75rem;
  }
  .shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    height: calc(100vh - 52px);
    min-height: 0;
  }
  .timeline {
    border-right: 1px solid #e4e4e0;
    background: #fafaf7;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }
  .timeline > header {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #e4e4e0;
    background: #fff;
  }
  .timeline h2 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
  }
  .timeline .body {
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .t-item {
    padding: 0.4rem 0.55rem;
    border: 1px solid #e4e4e0;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.8rem;
  }
  .t-item.active {
    border-color: #8a6a44;
    box-shadow: 0 1px 2px rgba(138, 106, 68, 0.2);
  }
  .t-item.warn { border-left: 3px solid #d99a3a; }
  .t-item.err  { border-left: 3px solid #b83a3a; }
  .t-item .op {
    font-weight: 600;
  }
  .t-item .sub {
    font-size: 0.72rem;
    color: #888;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .t-connector {
    align-self: center;
    width: 1px;
    height: 8px;
    background: #d6d4cf;
  }
  .t-add {
    padding: 0.35rem 0.55rem;
    border: 1px dashed #c4c0b8;
    border-radius: 5px;
    background: transparent;
    color: #8a7f6d;
    cursor: pointer;
    font-size: 0.72rem;
    font-family: inherit;
    font-weight: 500;
    text-align: left;
  }
  .t-add:hover {
    border-color: #6a80b4;
    color: #2f4f8a;
    background: #f4f6fb;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .hero {
    position: relative;
    flex: 0 0 40%;
    min-height: 260px;
    background: #1a1a1a;
    border-bottom: 1px solid #111;
  }
  .hero .hero-label {
    position: absolute;
    top: 8px;
    left: 12px;
    color: #f6f5f1;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-weight: 600;
    z-index: 2;
  }
  .hero .hero-sub {
    position: absolute;
    top: 8px;
    /* Leaves room for the viewport's top-right home button (22px
       wide at right: 8px → ends ~38px from the right edge). */
    right: 42px;
    color: #b8b5ae;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    z-index: 2;
  }
  .hero .hero-viewport {
    position: absolute;
    inset: 0;
  }
  .pipeline-wrap {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #fafaf7;
  }
  .pipeline-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid #e4e4e0;
    background: #fff;
  }
  .pipeline-head h2 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
  }
  .pipeline-head .hint {
    font-size: 0.72rem;
    color: #999;
  }
  .pipeline {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .flow {
    text-align: center;
    color: #b8b5ae;
    font-size: 1rem;
  }
  .stage {
    background: #fff;
    border: 1px solid #e4e4e0;
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }
  .stage.focused {
    border-color: #8a6a44;
    box-shadow: 0 2px 4px rgba(138, 106, 68, 0.2);
  }
  /* The Arrange stage is focusable (tabindex=0) so it can receive
     keydown events for F/R/E/O/etc. Suppress the browser's default
     focus ring — the existing .focused border + 'FOCUSED' badge
     already communicate focus. A keyboard-only focus-visible state
     can come back in the step-9 a11y pass if needed. */
  .stage:focus,
  .stage:focus-visible {
    outline: none;
  }
  .stage.warn { border-left: 3px solid #d99a3a; }
  .stage.err  { border-left: 3px solid #b83a3a; }
  .stage-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid #e4e4e0;
    cursor: pointer;
  }
  .stage-header h3 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .stage-header .sub {
    font-size: 0.72rem;
    color: #888;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .stage-header .warn-inline {
    font-size: 0.7rem;
    color: #a86a1a;
  }
  .stage-header .spacer {
    flex: 1;
  }
  .stage-header .badge {
    font-size: 0.65rem;
    background: #8a6a44;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stage-body {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 0;
    min-height: 220px;
  }
  .stage.focused .stage-body {
    grid-template-columns: 320px 1fr 1fr;
    min-height: 360px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid #e4e4e0;
  }
  .panel:last-child { border-right: none; }
  .p-head {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #999;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid #f1f0ec;
    background: #fafaf7;
  }
  .p-body {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
  }
  /* For the Arrange card: no internal scroll. The pane grows to fit
     the whole slice list — the outer pipeline column scrolls if it
     runs past the viewport. p-body switches from flex:1 (fill and
     scroll) to flex:auto (size to content); stage-body's min-height
     is dropped so the grid row isn't capped. */
  .p-body:has(:global(.arrange-ctrl-stack)) {
    overflow: visible;
    flex: 0 0 auto;
  }
  .stage-body:has(:global(.arrange-ctrl-stack)) {
    min-height: 0;
  }
  .preview-body {
    padding: 0.45rem;
    background: #f6f5f1;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  .preview-body :global(svg) {
    max-width: 100%;
    max-height: 100%;
  }
  .view-3d .p-body {
    padding: 0;
    overflow: hidden;
    background: #1a1a1a;
  }
  .compose-inventory-wrap {
    padding: 0.3rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-height: 0;
  }
</style>
