# Dotimation P3 — Polish Design Spec

**Date:** 2026-06-14
**Status:** Pending P3 sign-off
**Depends on:** P0/P1/P2 (all three backends shipped). Parent design:
`2026-06-14-dotimation-perf-rewrite-design.md`.

## Summary

The three-tier GPU engine (Canvas2D → WebGL2 → WebGPU) is functionally complete. P3 is the
polish pass — four independent items that finish the "masterpiece":

1. **`maxParticles`** — a density/perf cap (new optional prop).
2. **Benchmark stats** — an `onStats` callback exposing the resolved backend + live particle
   count, plus a benchmark mode in the playground to validate the perf targets.
3. **Cross-tier parity nits** — WebGL2 sub-pixel snapping + correct alpha blend so all three
   backends match pixel-for-pixel.
4. **Worker rasterization** — move text/image sampling off the main thread (OffscreenCanvas +
   Web Worker), with a robust main-thread fallback and no custom-font surprises.

Each is independent and independently shippable. Public API gains two additive optional props
(`maxParticles`, `onStats`) — no breaking changes.

## Goals & success metrics

| Item | Target |
| --- | --- |
| `maxParticles` | sampled particle count never exceeds the cap; the kept subset is uniformly random; off by default (no cap) |
| Benchmark | `onStats` fires with `{ backend, particles }` on backend/field changes; playground shows fps + count + tier and can stress to the targets |
| Parity | canvas2d / webgl2 / webgpu render a given frame within ~1px / negligible-alpha tolerance |
| Worker raster | no main-thread jank on content/size change when the worker path is used; identical output to main-thread; graceful fallback; correct fonts always |

Non-goals: WebGPU device-loss auto-recovery (separate future item), new visual features.

## Item 1 — `maxParticles`

A new optional prop `maxParticles?: number` (default: unbounded). The sampler already
Fisher–Yates–shuffles its output, so enforcement is a clean truncation: keep the first
`maxParticles` of the shuffled targets → a uniform random subset of the rasterized pixels.

- `sampleTargets` gains an optional `maxParticles` parameter (pure; the truncation happens
  after the shuffle so the kept set stays unbiased and spatially even). Default `Infinity`.
- Threaded through `rasterize` → `useFieldTargets` → the `Dotimation` prop.
- Documented as "cap the number of dots; trades fidelity for performance."

## Item 2 — Benchmark stats (`onStats`) + playground harness

A new optional prop `onStats?: (stats: DotimationStats) => void` where
`DotimationStats = { backend: 'webgpu' | 'webgl2' | 'canvas2d'; particles: number }`.

- The component reports stats when the engine is (re)created (resolved backend kind) and when
  a new field is pushed (active particle count). To know the resolved kind, `selectBackend`
  returns it alongside the backend (small internal shape change: return `{ backend, kind }` or
  attach `kind` — internal only).
- This finally lets the playground (and any consumer) show **which** backend `'auto'` chose —
  useful well beyond benchmarking.
- **Playground:** show `backend · particles · fps` in the overlay (fps already exists), and add
  a high-density stress preset (or wire `maxParticles`/`pointSpacingCss` controls) to push
  counts up and confirm 60fps on each tier.

## Item 3 — Cross-tier parity nits (WebGL2)

Two small WebGL2 changes so it matches Canvas2D (the reference) and WebGPU:

- **Sub-pixel snapping:** Canvas2D writes dots at integer device pixels (`(x*dpr + 0.5)|0`).
  The WebGL2 (and WebGPU) draw vertex shaders place quads at continuous device positions. Snap
  the instance position to the device-pixel grid in the WebGL2 `draw.vert` (and WebGPU
  `draw.wgsl`) so small dots land on the same pixel across tiers.
- **Alpha blend:** WebGL2 uses `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, which computes a
  slightly wrong destination *alpha*. Switch to `blendFuncSeparate(SRC_ALPHA,
  ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)` for a correct source-over alpha channel,
  matching WebGPU's separate-alpha blend.

Both are tiny and verified by eye against canvas2d in the playground.

## Item 4 — Worker rasterization

Move the expensive rasterize (draw + `getImageData` + sample) off the main thread when safe.

### Correctness-first font rule

Workers have a **separate font set** from the document, so drawing custom-font text in a worker
can silently fall back to a default. To guarantee correctness, the worker is used only when it
cannot cause a font discrepancy:

- **Images** → always worker-eligible (no fonts involved; the worker `fetch`es the URL and uses
  `createImageBitmap`).
- **Text with a generic/system family** (`sans-serif`, `serif`, `monospace`, `system-ui`,
  `ui-monospace`, `cursive`, `fantasy`, or unset → the default `'sans-serif'`) → worker-eligible
  (generics resolve in the worker).
- **Text with a custom family** → main-thread `rasterize` (document fonts available there). This
  is typically a small, deliberate piece, and stays pixel-correct.

A pure `isWorkerSafe(item, defaultFontFamily)` helper encodes this and is unit-tested.

### Architecture

- `src/raster/rasterize.ts` stays as the **main-thread implementation and fallback** (already
  splits pure `sampleTargets` from the DOM draw).
- `src/raster/raster.worker.ts` — the worker: on message, draws to an `OffscreenCanvas`, runs
  the shared pure `sampleTargets` + `font` helpers, and posts back the `FieldTargets` typed-array
  buffers as transferables (zero-copy).
- `src/raster/rasterize-worker.ts` — host side: lazily creates the worker
  (`new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' })`), manages a
  request id ↔ promise map, and exposes `rasterizeViaWorker(...)` returning `Promise<FieldTargets>`.
- `src/raster/index.ts` (or `useFieldTargets`) chooses: if `isWorkerSafe` AND `OffscreenCanvas`
  + `Worker` exist → try the worker; on ANY failure (creation, message error, timeout) →
  fall back to main-thread `rasterize`. The worker is created once and reused.

### Shipping / robustness

- `new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' })` is the
  standard module-worker form that Vite/webpack/esbuild/Rollup emit correctly; the library's own
  build (`bunup`) is configured to emit the worker chunk. A `try/catch` around worker creation
  and a per-request fallback mean a consumer whose bundler mishandles workers still works (just
  on the main thread) — **the worker never breaks the library, it only ever speeds it up.**
- Stale-result guarding stays in `useFieldTargets` (the existing `executionId`).

## Public API (additive only)

Existing props unchanged. New optional props:
- `maxParticles?: number` — cap on dots (default unbounded)
- `onStats?: (stats: { backend: 'webgpu' | 'webgl2' | 'canvas2d'; particles: number }) => void`

## Testing

- **Unit-tested pure helpers:** `sampleTargets` truncation honoring `maxParticles` (count cap +
  unbiased subset); `isWorkerSafe` (images, generic vs custom fonts, unset family).
- **Playground-verified:** the parity nits (toggle tiers, compare), the worker path (no jank on
  large content; identical output; custom-font text still correct via main-thread fallback), and
  the `onStats`/benchmark overlay.

## Phasing within P3 (each independently committable)

1. `maxParticles`: `sampleTargets` truncation (TDD) → thread through rasterize/hook/prop.
2. Parity nits: WebGL2 `draw.vert` snap + `blendFuncSeparate` (and WebGPU snap for consistency).
3. `onStats`: `selectBackend` returns resolved kind; component reports stats; playground overlay
   shows backend + count.
4. Worker rasterization: `isWorkerSafe` (TDD) → worker + host + selection with fallback →
   playground stress; docs (CLAUDE.md, README props).

## Risks & mitigations

- **Worker bundling fragility** → module-worker form + `try/catch` + per-request main-thread
  fallback; the worker is purely an optimization.
- **Custom-font discrepancy** → `isWorkerSafe` routes custom-font text to the main thread; only
  generics/images use the worker.
- **Parity blend change** regressing the look → verify against canvas2d by eye; the change only
  corrects the alpha channel.
- **`maxParticles` bias** → truncation is applied AFTER the existing shuffle, keeping the subset
  uniform and spatially even.
- **Stats over-firing** → report on engine (re)creation and field push only, not per frame.

## Open questions for the plan

- Whether to also add a `pointSpacingCss`/`maxParticles` slider to the playground or just a
  high-density preset — default to a preset to keep the harness simple.
- WebGPU snap: apply the same device-pixel snap in `draw.wgsl` for tri-tier consistency (yes,
  for symmetry, since WebGPU and WebGL2 share the continuous-position approach).
