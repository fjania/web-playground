/**
 * Focused harness entry point for the ComposeStrips operation.
 *
 * First-of-its-kind harness: the Input and Operation tiles are
 * interactive DOM components. The user builds a strip inventory
 * (Input tile), drags strips to reorder them (Operation tile), and
 * watches the composed panel update in 3D (Output tile).
 *
 * State shape (kept local to this harness, NOT persisted to URL):
 *
 *   {
 *     inventory: StripDef[],  // editable in Input tile
 *     order:     string[],    // stripIds in drag order
 *     stripHeight: number,
 *     stripLength: number,
 *   }
 *
 * The pipeline still consumes the existing `ComposeStrips` feature
 * type — the ordered `strips` field is resolved from
 * `order.map(id => inventoryById[id])` before each run. That way
 * `types.ts` and the pipeline executor stay untouched; all the new
 * work lives in the harness + UI modules.
 *
 * URL params are SEED ONLY. Edits in the tiles do not write back to
 * the URL. See 3d-v2-compose.html's sidebar for the param reference.
 *
 * Snapshot-is-truth invariant: the Output tile builds its 3D mesh
 * from the `livePanels[compose-0]` Panel surfaced under
 * `preserveLive: true`. The harness never shortcuts to a mesh
 * derived from the URL / inventory state directly.
 */

import { initManifold } from '../domain/manifold';
import { createIdCounter, allocateId } from './state/ids';
import { runPipeline } from './state/pipeline';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport } from './scene/viewport';
import type { ViewportHandle } from './scene/viewport';
import type {
  ComposeStrips,
  ComposeStripsResult,
  Feature,
  Species,
  StripDef,
} from './state/types';
import {
  mountStripInventory,
  type InventoryHandle,
  type InventoryState,
} from './ui/strip-inventory';
import {
  mountStripReorder,
  type ReorderHandle,
} from './ui/strip-reorder';

await initManifold();

// ---- ID counter ----

const counter = createIdCounter();
// Seat compose-0 in the counter (there's only ever one ComposeStrips).
allocateId(counter, 'compose');

// ---- URL param parsing ----

const params = new URLSearchParams(window.location.search);

interface HarnessState {
  inventory: StripDef[];
  order: string[];
  stripHeight: number;
  stripLength: number;
}

function parseInitialState(): HarnessState {
  const SPECIES_SET: ReadonlySet<Species> = new Set<Species>([
    'maple',
    'walnut',
    'cherry',
    'padauk',
    'purpleheart',
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
    if (inventory.length === 0) {
      // Malformed param — fall through to default seed.
      inventory = defaultInventory();
    }
  } else {
    inventory = defaultInventory();
  }

  // Resolve the arrangement. `?order=3,1,0,2` — indices into the
  // inventory. Defaults to [0, 1, 2, ...].
  const orderParam = params.get('order');
  let order: string[];
  if (orderParam) {
    const idxs = orderParam
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < inventory.length)
      .map((n) => Math.floor(n));
    // Only accept ?order if it's a full permutation of inventory
    // indices. If the user wrote a partial/garbled list, fall back
    // to identity so the arrangement stays a well-formed
    // permutation.
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

/**
 * Default seed per the harness spec: 14 strips, 7 maple + 7 walnut,
 * all 50 mm wide. Matches the user's direct specification.
 */
function defaultInventory(): StripDef[] {
  const out: StripDef[] = [];
  for (let i = 0; i < 7; i++) {
    out.push({
      stripId: allocateId(counter, 'strip'),
      species: 'maple',
      width: 50,
    });
  }
  for (let i = 0; i < 7; i++) {
    out.push({
      stripId: allocateId(counter, 'strip'),
      species: 'walnut',
      width: 50,
    });
  }
  return out;
}

function positiveNumber(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- Live state ----

let state: HarnessState = parseInitialState();
let viewportHandle: ViewportHandle | null = null;

// ---- Mount interactive tiles ----

const inputTile = requireTile('compose-0-input');
const inputSlot = requireSlot(inputTile);

const inventoryHandle: InventoryHandle = mountStripInventory(
  inputSlot,
  toInventoryState(state),
  {
    allocateStripId: () => allocateId(counter, 'strip'),
    onChange: (next) => {
      // Reconcile: any new stripIds in inventory get appended to
      // order; any removed stripIds get filtered out. This keeps
      // `order` a permutation of `inventory`.
      const prevIds = new Set(state.inventory.map((s) => s.stripId));
      const nextIds = new Set(next.inventory.map((s) => s.stripId));

      const added: string[] = [];
      for (const s of next.inventory) {
        if (!prevIds.has(s.stripId)) added.push(s.stripId);
      }
      let order = state.order.filter((id) => nextIds.has(id));
      order = [...order, ...added];

      state = {
        inventory: next.inventory,
        order,
        stripHeight: next.stripHeight,
        stripLength: next.stripLength,
      };
      rerunPipeline();
    },
  },
);

const opTile = requireTile('compose-0-op');
const opSlot = requireSlot(opTile);

const reorderHandle: ReorderHandle = mountStripReorder(
  opSlot,
  {
    inventory: state.inventory,
    order: state.order,
    stripLength: state.stripLength,
  },
  {
    onChange: (nextOrder) => {
      state = { ...state, order: nextOrder };
      rerunPipeline();
    },
  },
);

// ---- Pipeline + rendering ----

rerunPipeline();

function rerunPipeline(): void {
  // Resolve `strips` in arrangement order before feeding the
  // pipeline. The existing `ComposeStrips` feature type stays
  // untouched — the ordering lives in the harness, not in
  // types.ts.
  const byId = new Map(state.inventory.map((s) => [s.stripId, s]));
  const orderedStrips: StripDef[] = state.order
    .map((id) => byId.get(id))
    .filter((s): s is StripDef => s !== undefined);

  const compose: ComposeStrips = {
    kind: 'composeStrips',
    id: 'compose-0',
    strips: orderedStrips,
    stripHeight: state.stripHeight,
    stripLength: state.stripLength,
    status: 'ok',
  };

  const timeline: Feature[] = [compose];
  const output = runPipeline(timeline, { preserveLive: true });
  const composeResult = output.results['compose-0'] as ComposeStripsResult;
  const livePanels = output.livePanels ?? {};
  const livePanel = livePanels['compose-0'];
  if (!livePanel) throw new Error('compose did not preserve live panel');

  // ---- Input tile: meta (component already rendered) ----
  setSubtitle(
    inputTile,
    `compose-0 · ${state.inventory.length} strips in inventory`,
  );
  setMeta(
    inputTile,
    `inventory: ${formatSpeciesTally(state.inventory)}`,
  );

  // ---- Operation tile: refresh reorder UI, show arrangement tally ----
  // Rerender the reorder UI so any inventory changes (add/remove) are
  // reflected. A pure reorder from the reorder UI itself already
  // repaints — calling update() again on the same order is a no-op
  // visually beyond the DOM rebuild.
  reorderHandle.update({
    inventory: state.inventory,
    order: state.order,
    stripLength: state.stripLength,
  });
  setSubtitle(opTile, `compose-0 · ${state.order.length} strips arranged`);
  setMeta(
    opTile,
    `arrangement: ${formatOrderTally(orderedStrips)}`,
  );

  // ---- Output tile: 3D viewport ----
  const outputTile = requireTile('compose-0');
  // Dispose old viewport before mounting a fresh one — the live panel
  // from the previous run gets GC'd, and we want a clean slot for
  // the new meshes.
  if (viewportHandle) {
    viewportHandle.dispose();
    viewportHandle = null;
  }
  const panelGroup = buildPanelGroup(livePanel);
  viewportHandle = setupViewport(outputTile, panelGroup, { vertical: 'x' });
  const bb = composeResult.panel.bbox;
  const sx = (bb.max[0] - bb.min[0]).toFixed(0);
  const sy = (bb.max[1] - bb.min[1]).toFixed(0);
  const sz = (bb.max[2] - bb.min[2]).toFixed(0);
  setSubtitle(
    outputTile,
    `compose-0 · panel ${sx}×${sy}×${sz} mm`,
  );
  setMeta(
    outputTile,
    `${composeResult.panel.volumes.length} volumes · ` +
      `total width ${sx} mm`,
  );

  // ---- Sidebar ----
  const summarySlot = document.querySelector<HTMLElement>(
    '[data-slot="state-summary"]',
  );
  if (summarySlot) {
    summarySlot.textContent =
      `thickness  ${state.stripHeight} mm\n` +
      `length     ${state.stripLength} mm\n` +
      `inventory  ${state.inventory.length} strips\n` +
      `arranged   ${state.order.length} strips\n` +
      `panel      ${sx} × ${sy} × ${sz} mm`;
  }

  const traceSlot = document.querySelector<HTMLElement>(
    '[data-slot="trace"]',
  );
  if (traceSlot) {
    const lines = output.trace.map((id) => {
      const r = output.results[id];
      const status = r?.status ?? '?';
      return `${id} · ${status} · ${(r as ComposeStripsResult)?.panel?.volumes?.length ?? 0} vols`;
    });
    traceSlot.textContent = lines.join('\n');
  }
}

// ---- helpers ----

function requireTile(stageId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-stage="${stageId}"]`,
  );
  if (!el) throw new Error(`missing tile data-stage=${stageId}`);
  return el;
}

function requireSlot(tile: HTMLElement): HTMLElement {
  const slot = tile.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) throw new Error(`tile missing render slot`);
  // Clear placeholder before we mount.
  slot.innerHTML = '';
  return slot;
}

function setMeta(tile: HTMLElement, text: string): void {
  const slot = tile.querySelector<HTMLElement>('[data-slot="meta"]');
  if (slot) slot.textContent = text;
}

function setSubtitle(tile: HTMLElement, text: string): void {
  const subtitle = tile.querySelector<HTMLElement>('.subtitle');
  if (subtitle) subtitle.textContent = text;
}

function toInventoryState(s: HarnessState): InventoryState {
  return {
    inventory: s.inventory.map((x) => ({ ...x })),
    stripHeight: s.stripHeight,
    stripLength: s.stripLength,
  };
}

function formatSpeciesTally(strips: StripDef[]): string {
  const tally = new Map<string, number>();
  for (const s of strips) {
    tally.set(s.species, (tally.get(s.species) ?? 0) + 1);
  }
  return Array.from(tally.entries())
    .map(([sp, n]) => `${n} ${sp}`)
    .join(' · ');
}

function formatOrderTally(strips: StripDef[]): string {
  // e.g. "maple(50)·walnut(50)·…" truncated at 8 strips.
  const MAX = 8;
  const shown = strips.slice(0, MAX).map((s) => `${s.species}(${s.width})`);
  const tail = strips.length > MAX ? ` +${strips.length - MAX} more` : '';
  return shown.join(' · ') + tail;
}

// Silence "unused" for the inventory-handle cleanup (we keep it alive
// for the lifetime of the page; a future framework integration would
// call dispose() on unmount).
void inventoryHandle;
