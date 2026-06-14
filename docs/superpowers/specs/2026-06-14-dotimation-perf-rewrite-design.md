# Dotimation Performance Rewrite — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan
**Scope:** Full performance re-architecture of the `dotimation` rendering/simulation engine.

## Summary

`dotimation` renders text or images as a field of animated dots on a canvas, with
spring physics that morphs between layouts. The current implementation is a single
Canvas2D renderer driving an array-of-objects particle model on the main thread; it
is correct and readable but caps out at low tens of thousands of particles, never
stops animating once started, and rasterizes on the critical path.

This rewrite makes performance the headline feature: a runtime-selected GPU engine
(**WebGPU → WebGL2 → Canvas2D**) with the simulation running on the GPU per-backend,
a Structure-of-Arrays data model, off-main-thread rasterization, and a deterministic
settle/sleep so idle animations cost ~0% CPU. The public API stays a drop-in
superset of today's.

> **Latitude:** the current code was written quickly. Beyond the performance work,
> targeted quality improvements to code we are already touching are in scope (clearer
> boundaries, naming, removing dead code, fixing the stale README). Unrelated
> refactoring is not.

## Goals & success metrics

| Metric | Target |
| --- | --- |
| Throughput (WebGL2, mid-tier laptop) | 60 fps at ~250k particles |
| Throughput (WebGPU) | 1M+ particles at 60 fps |
| Throughput (Canvas2D fallback) | usable to ~30–50k |
| Idle CPU when settled | ~0% (rAF fully stopped) |
| Content/size change | no main-thread jank (rasterization off critical path) |
| Bundle | backends lazy-loaded; a device downloads only the tier it runs |
| Visual output (Canvas2D tier) | zero regression vs current (parity is the oracle) |

Non-goals this round: interactivity (mouse repel/attract) ships in a later release but
the engine is *designed* to accommodate it. Shrinking particle capacity mid-session is
out of scope (capacity only grows).

## Architecture

### Module layout

```
src/
  index.tsx                  # public exports (unchanged surface)
  components/dotimation.tsx   # thin React wrapper; owns canvas element + lifecycle
  engine/
    engine.ts                # shared orchestrator (timing, settle, resize, visibility)
    backend.ts               # Backend contract (interface) + capability detection
    select.ts                # runtime pick: webgpu → webgl2 → canvas2d, dynamic import
    field.ts                 # ParticleField: SoA typed arrays + reconcile/slot logic
  backends/
    webgpu/                  # compute-shader sim + instanced render (WGSL)
    webgl2/                  # transform-feedback sim + instanced render (GLSL)
    canvas2d/                # current renderer refactored onto SoA
  raster/
    rasterize.ts             # content → ParticleField (OffscreenCanvas sampling)
    worker.ts                # optional worker host for rasterize
  utils/font.ts              # unchanged (auto-sizing heuristics)
  types.ts
```

### Core data model — Structure of Arrays

Replace `Particle[]` (array of 13-field objects) with one `ParticleField` of typed
arrays sized to a **capacity** (power-of-two, grown by reallocation, never shrunk
mid-session):

- `Float32Array`: `x, y, vx, vy, homeX, homeY`
- color channels (`r, g, b, homeR, homeG, homeB`) as `Float32Array` or `Uint8` —
  decided during P0 against the GPU upload format
- `Float32Array`: `alpha, targetAlpha`
- scalars: `count` (live), `capacity` (allocated)

This is the backend-agnostic interchange format. CPU writes it during rasterization;
GPU backends upload it into storage/vertex buffers with a single `writeBuffer` /
`bufferData` — no per-particle marshalling, no GC churn, cache-friendly iteration.

### Unified morph model

The current two buffers (`particlesRef` live + `intermediateRef` fading-out) collapse
into **one fixed-capacity buffer with per-particle `targetAlpha`**:

- **Overlap** (slot exists in old and new field): retarget `home*`; the spring morphs
  it smoothly.
- **Growth** (new field larger): activate spare slots, seed position from an existing
  particle so new dots fly in from a believable origin, `targetAlpha = 1`.
- **Shrink** (new field smaller): surplus slots get `targetAlpha = 0` and a recycled
  valid `home*`; once `alpha ≈ 0` they become free slots reusable on the next change.

No array splicing, no `structuredClone`, identical visual behavior, and the same model
works on CPU and GPU.

### Shared orchestrator (`engine.ts`)

Owns all timing and lifecycle, written once and backend-independent:

- **Fixed-timestep accumulator** preserved from today (90 Hz physics, decoupled
  render, `maxStepsPerFrame` clamp).
- **Settle/sleep via deterministic wake budget:** springs are deterministic, so on each
  retarget the engine computes `awakeUntil = now + settleTime + fadeTime` and runs the
  rAF loop only until then, then cancels it — no GPU readback required. Re-armed on prop
  change, size change, or (future) interaction.
- **DPR** handling (capped at 2) and resize.
- **Visibility:** `IntersectionObserver` pauses the loop when the canvas scrolls
  off-screen (tab-hidden is already handled by rAF).
- Drives the active backend through the contract below; never touches shaders.

### Backend contract (`backend.ts`)

Narrow and uniform across all three tiers:

```ts
interface Backend {
  init(canvas: HTMLCanvasElement, dpr: number): Promise<void> | void
  uploadField(field: ParticleField): void   // push new/changed targets
  step(dt: number): void                     // advance simulation by dt
  draw(): void                               // render current state
  resize(devW: number, devH: number): void
  dispose(): void
}
```

Backends own only their simulate + draw work. They never touch timing, React, or the
DOM lifecycle.

### Backends

- **WebGPU** — particle state in storage buffers; a **compute shader** integrates the
  spring/color/opacity each step; instanced point-sprite quads for render (enables
  `dotSize`). Handles `device.lost` by tiering down.
- **WebGL2** — **transform feedback** ping-pong VBOs for physics; instanced quads (or
  `gl.POINTS`) for render. Handles context loss by re-init or tier-down. Watch
  transform-feedback varying limits at high counts (may need interleaved buffers).
- **Canvas2D** — today's `ImageData`/`Uint32` renderer refactored onto the SoA model,
  **with micro-optimizations**: hoist the endianness branch out of the per-pixel loop,
  dirty-rect clear + `putImageData` instead of full-canvas every frame, and zero work
  while sleeping. This tier is the **visual-parity reference**.

### Rasterization (`raster/`)

Content → `ParticleField`, off the critical path:

- `OffscreenCanvas` + `createImageBitmap` for decode/sampling; same grid-sample +
  alpha-threshold + Fisher–Yates shuffle as today.
- Runs in a **Web Worker** when available, transferring typed-array buffers back
  (zero-copy). Falls back to main-thread OffscreenCanvas, then DOM canvas.
- Stale-result guarding via the existing `executionId` pattern.

### Backend selection (`select.ts`)

Probe capabilities, then **dynamically `import()`** only the chosen backend module so
the others never hit the bundle:

1. `backend` prop override (`'webgpu' | 'webgl2' | 'canvas2d'`) wins if forced.
2. Otherwise `'auto'`: try WebGPU adapter → WebGL2 context → Canvas2D.
3. On runtime failure (context loss, adapter loss), tier down and re-init.

## Public API (additive only)

Existing props unchanged: `item, width, height, canvasRef, className, style,
defaultFontFamily, alpha, pointSpacingCss`. New optional props:

- `dotSize?: number` — device-px radius (today fixed at 1)
- `maxParticles?: number` — density / performance cap
- `backend?: 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'` — default `'auto'`
- `idle?: 'sleep' | 'animate'` — default `'sleep'`

SSR safety preserved (`'use client'`, all GPU/Worker/`window` access guarded). `canvasRef`
imperative handle preserved.

## Testing & benchmarks

Performance is the feature, so it is measured:

- **Unit tests** (`bun test` — real coverage for the first time) for backend-agnostic
  core: rasterization sampling, `ParticleField` reconcile/slot logic, settle-time
  computation, backend selection with mocked capabilities, font sizing.
- **Benchmark harness** in `test/ui`: live FPS / frame-time / particle-count overlay,
  backend switcher, stress presets — validates the §Goals targets.
- GPU backends verified visually through the playground (headless GPU CI is unreliable);
  a parity test pins Canvas2D output as the correctness reference.

## Phasing

Each phase is independently shippable.

- **P0 — CPU re-architecture.** SoA `ParticleField` + unified morph + rasterization
  refactor + Canvas2D backend on the new orchestrator + settle/sleep + micro-opts.
  Immediate win, no visual regression, validates the orchestrator/backend contract.
- **P1 — WebGL2 backend.** Transform-feedback physics + instanced render + selection /
  fallback + dynamic import. The ~98% acceleration tier.
- **P2 — WebGPU backend.** Compute-shader physics + instanced render.
- **P3 — Polish.** New props, worker-based rasterization, benchmark harness, docs (incl.
  fixing the stale react-query README claim). Interactivity stays designed-for but
  unexposed.

## Risks & mitigations

- **Visual parity** of GPU alpha compositing vs the current per-pixel source-over blend
  → pin against the Canvas2D reference with a tolerance.
- **GPU context / device loss** → graceful tier-down in `select.ts`.
- **WebGL2 transform-feedback varying limits** at high particle counts → multi-pass or
  interleaved buffers.
- **SSR / no-DOM** → `'use client'` and guard every GPU/Worker/`window` access.
- **Bundle growth** from shaders → mitigated by per-backend dynamic import.
- **Stale README** (claims react-query, which the project does not use) → fixed in P3.

## Open questions for implementation planning

- Color channel storage format (`Uint8` vs `Float32`) — decide in P0 against the GPU
  upload path.
- Exact `dotSize` semantics across tiers (point-sprite radius vs Canvas2D pixel
  footprint) — must look consistent.
- Whether worker rasterization lands in P0 or P3 (design allows either; currently P3).
