# Focused per-operation harnesses

A pattern for iterating on each feature's Input → Operation → Output (I/X/O) behaviour in isolation, locked into a constrained environment. Each harness is a standalone HTML page + TypeScript entrypoint with one operation's I/X/O rendered in the three-tile layout.

This file is the repo-level companion to [issue #31 — Timeline panel UI](https://github.com/fjania/web-playground/issues/31), whose "Per-operation iteration loop" section is the canonical reference. Start there for the full context.

## Why per-operation harnesses exist

The main canvas (in `3d-cut.html`) is a general editor — eventually, once #31's selection-driven rebinding lands, it will host every operation's I/X/O via a timeline navigator. Before that lands, each operation needs a place to iterate without the noise of other features.

The answer is a **focused harness** per operation: a page that renders exactly that operation's I/X/O, with the operation's parameters exposed as URL params. No UI controls, no inspector panel clutter, no timeline distractions. Just the operation, its inputs, and its output — plus URL knobs so parameter sweeps happen without touching any affordance.

When an operation's math, rendering, and authoring UI are locked in, the work folds back into `3d-cut.html` via #31's navigator. The renderers (in `src/render/operations.ts`) and the 3D scaffolding (in `src/scene/viewport.ts`) are shared between the harness and the main canvas, so every improvement propagates.

## Existing harnesses

| Harness | Target operation | Issue | Entry point |
|---|---|---|---|
| `3d-cut.html` | Cut | [#24](https://github.com/fjania/web-playground/issues/24) | `src/main-cut.ts` |
| `3d-arrange.html` | Arrange | — (spans #27–#30, #35–#36) | `src/main-arrange.ts` |
| `3d-trim.html` | TrimPanel | [#37](https://github.com/fjania/web-playground/issues/37) | `src/main-trim.ts` |
| `3d-compose.html` | ComposeStrips | [#23](https://github.com/fjania/web-playground/issues/23) | `src/main-compose.ts` |

Every harness composes shared control components from `src/ui/` so the authoring surface stays in sync with the workbench. Concretely:

- **ComposeStrips** — `StripInventory` (add/remove/edit strips) + `StripReorder` (drag-to-reorder).
- **Cut** — `CutControls` (orientation / rip / bevel / spacing / slice count / showOffcuts).
- **Arrange** — `ArrangeControls` (selection toolbar + action toolbar + `SliceList`) alongside `ArrangePreview` (drag-to-reorder + click-to-select on the preview). Shared keyboard handler lives in `src/state/arrangeActions.ts`.
- **TrimPanel** — `TrimControls` (mode + bounds).

Every harness still accepts URL params as **seeds** for its initial state; after load, the interactive components take over. URL round-trip back from interactive state is intentionally NOT done (matches the "URL is a seed" convention the ComposeApp established).

More to come — PlaceEdit ([#27](https://github.com/fjania/web-playground/issues/27)/[#28](https://github.com/fjania/web-playground/issues/28)/[#29](https://github.com/fjania/web-playground/issues/29)/[#35](https://github.com/fjania/web-playground/issues/35)), SpacerInsert ([#36](https://github.com/fjania/web-playground/issues/36)). Each of these will land its own `3d-<op>.html` + `main-<op>.ts` pair as the issue comes up.

## The iteration loop

From the section added to #31:

1. **Spin up a focused harness** (`3d-<op>.html`) with a minimal timeline centred on the target operation. Only that operation's I/X/O is rendered; no other features clutter the page.
2. **URL-param configuration**: expose every knob the feature supports as a URL param (e.g. `?rip=30&bevel=60&slices=6` for Cut; `?flip=1,3&reorder=0,3,1,2` for Arrange). Lets parameter sweeps happen without UI affordances that don't exist yet.
3. **Inspection aids** on the Output tile: axis gizmo (upper-right, colour-coded XYZ), home button to reset the view, free-orbit TrackballControls. Makes 3D geometry inspectable from any angle — crucial for verifying bevel, rotations, slice boundaries, etc.
4. **Snapshot-is-truth invariant**: the Operation tile and Output tile derive geometry from the pipeline's result (`CutResult.slices`, `CutResult.offcuts`, `ArrangeResult.panel`, etc.), *not* from the feature's parameters. Prevents the renderer and pipeline from drifting.
5. **Iterate with the user**: screenshot → observation → diagnose → smallest fix → commit → repeat. Each commit's message captures the prompt that drove it so the git log traces the iteration history.
6. **Lock in with a parameter sweep test**: vitest `describe.each` over the feature's parameter space, verifying slice counts, output bbox, invariant-preservation, etc.
7. **Fold back into the main canvas** once #31's selection-driven rebinding is live. Operation-view renderers (`src/render/operations.ts`) and output meshes (`src/scene/meshBuilder.ts`, `src/scene/viewport.ts`) are shared between the focused harness and the main canvas, so lock-in work carries over automatically.

## Scaffolding a new harness

To add a focused harness for operation `X`:

1. Copy `3d-arrange.html` → `3d-<X>.html`. Update `<title>`, `<h1>`, the tile labels, the URL-param help text, and the `<script src>` pointing at the new entry point.
2. Copy `src/main-arrange.ts` → `src/main-<X>.ts`. Adapt:
   - The default timeline (usually `defaultTimeline(counter)` + feature-specific overrides).
   - The URL-param parsing (feature-specific knobs).
   - The three tile rendering calls — use `summarize` / operation-view renderers / `setupViewport` as the focused harness needs.
3. If operation `X` needs its own operation-view renderer, add it to `src/render/operations.ts` (see `renderCutOperation` and `renderArrangeOperation` as references). The renderer must derive geometry from the feature's `Result`, never from its parameters.
4. If the Output tile needs new 3D-only affordances, add them to `src/scene/viewport.ts` so they propagate to every harness and to the main canvas.
5. Add unit tests to `test/v2/operations.test.ts` covering the new renderer.

## Shared building blocks

| Module | Role | Used by |
|---|---|---|
| `src/scene/viewport.ts` | `setupViewport()` — WebGLRenderer + PerspectiveCamera + TrackballControls + axis gizmo + home button | Every harness |
| `src/scene/meshBuilder.ts` | `buildPanelGroup()` (live manifold), `buildGroupFromSnapshot()` (snapshot) | Every harness + output rendering |
| `src/render/summary.ts` | `summarize()`, `summarizeSlices()` — top-down 2D SVG summaries | Every harness's 2D tiles |
| `src/render/operations.ts` | Per-operation view renderers | Harnesses + main canvas Operation tile |
| `src/state/pipeline.ts` | `runPipeline()` with `preserveLive: true` for 3D output | Every harness |

If the thing you're building touches the 3D viewport, a 2D summary, or the Operation tile of multiple operations, it probably belongs in one of the shared modules above rather than in the per-operation `main-<op>.ts`.
