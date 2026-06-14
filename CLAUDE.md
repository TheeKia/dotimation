# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`dotimation` is a single-component React library ("Animate anything with dots"). It renders text or images as a field of animated dots on a `<canvas>`, with spring physics that morphs smoothly between layouts when the content or size changes. The public API is just `<Dotimation>` plus its types (`src/index.tsx`).

Runtime targets: React 19 + react-dom 19 (peer deps). The package ships ESM-only from `dist/`.

## Commands

Bun is the only supported toolchain (`bun.lock`, `bunfig.toml`). Do not use npm/yarn/pnpm.

- `bun install` — install deps
- `bun run dev` — start the Vite playground (`test/ui`) that imports the library **directly from `src/`** (see its `vite.config.ts` alias); no build needed to see changes
- `bun run build` — bundle to `dist/` via `bunup` (minified, no sourcemaps; config is all CLI flags, no `bunup.config.ts`)
- `bun run type-check` — `tsc --noEmit`
- `bun run lint` / `bun run lint:fix` — Biome check / autofix
- `bun test` — run tests; `bun test path/to/file.test.ts` for a single file; `bun test -t "name"` for a single test; `bun run test:watch`, `bun run test:coverage`
- `bun run release` — `bumpp` bumps version, commits, tags, and pushes; the `v*` tag triggers `.github/workflows/release.yml` which publishes to npm

A `simple-git-hooks` pre-commit hook runs `lint` + `type-check`. CI (`ci.yml`) runs build → type-check → lint → test on Linux/macOS/Windows.

## Architecture: the particle pipeline

The library is one data flow from source content to animated pixels. There is a strict **pure-core / DOM-shell split**: pure logic (field, sampler, simulate, render, settle, clock) is unit-tested under `bun test`; DOM/React-bound shells (rasterize, engine, backend, component) are exercised in the `test/ui` playground.

1. **Rasterize** (`src/raster/`) — `rasterize()` (DOM shell) draws the `AnimateItem` (text or image) onto an offscreen canvas and calls the pure `sampleTargets()` (`src/raster/sample.ts`) to walk the pixel buffer on a grid (`pointSpacingCss` step) and produce `FieldTargets` — a Structure-of-Arrays (SoA) of home positions and colors for every sampled pixel. Text auto-sizing lives in `src/utils/font.ts` (`AUTO` = glyph-weighted heuristic, `AUTO_MONO` = monospace blend). The `useFieldTargets` hook (`src/hooks/use-field-targets.ts`) re-rasterizes when `item` (shallow-compared) or `width`/`height` change; an `executionId` ref discards stale async results.

2. **Field model** (`src/engine/field.ts`) — one `ParticleField` of typed Float32Arrays (Structure-of-Arrays). `reconcile(field, targets)` maps the old layout onto new targets in a single fixed-capacity buffer: slots `[0, active)` are the live layout, slots `[active, count)` are faders leaving (per-particle `targetAlpha = 0`). The buffer grows via `growField` (rounds up to next power-of-2) only when needed. This replaces the old two-buffer reconcile approach.

3. **Orchestrator** (`src/engine/engine.ts`) — owns the rAF loop, a fixed-timestep accumulator (`src/engine/clock.ts`, 90 Hz physics), deterministic settle/sleep (`src/engine/settle.ts` — stops the loop ~1.5 s after the last change, so idle CPU cost is ~0%), and an `IntersectionObserver` for visibility gating. Exposes `setField` / `resize` / `dispose` and drives a `Backend` interface.

4. **Backends** (`src/backends/`) — a `Backend` implements `init / uploadField / step / draw / resize / dispose`. Three backends ship:
   - **`canvas2d`** (P0, `src/backends/canvas2d/`): SoA spring simulation in `simulate.ts` and a `Uint32`/`ImageData` pixel-push renderer in `render.ts` with hoisted endianness detection.
   - **`webgl2`** (P1, `src/backends/webgl2/`): runs the particle simulation on the GPU via **transform feedback** and renders dots as **instanced quads**. Uses the shared pure planner `src/engine/reconcile-plan.ts` (`planReconcile` → `FieldDelta`) for readback-free reconcile→GPU sync (P0's `reconcile` was refactored onto the same planner). New unit-tested pure helpers: `src/engine/viewport.ts` (CSS-px→clip) and `src/engine/reconcile-plan.ts`. The GL pieces are playground-verified (no headless GL).
   - **`webgpu`** (P2, `src/backends/webgpu/`): runs the particle physics in a **WGSL compute shader** over storage buffers and renders dots as **instanced quads**. `@webgpu/types` is a devDependency. Playground-verified (no headless WebGPU).

   `src/engine/select.ts` is an **async cascade**: `resolveBackendOrder` (`src/engine/cascade.ts`) yields the ordered tier list (`webgpu → webgl2 → canvas2d`), then `selectBackend` construct-and-inits each tier in order — both GPU tiers are loaded via **dynamic `import()`** (code-split) — falling through to the next tier on any construct/init failure, with Canvas2D as the always-present safety net.

### Coordinate systems & DPR

Particle positions are in **CSS pixels**; the canvas backing store is **device pixels** (`width * dpr`). `dpr` is `min(devicePixelRatio, 2)`. The component sizes the canvas via `sizeCanvas` (`src/utils/utils.ts`) — a context-less helper — so each backend can acquire its own `2d` or `webgl2` context independently. `getCtx` remains for the rasterizer's offscreen canvas. The engine passes `dpr` to the backend at `init`; the backend handles device-pixel conversion internally.

## Conventions & gotchas

- **`isolatedDeclarations: true`** (tsconfig) — every exported function/component needs an explicit return type. This is why `Dotimation` is annotated `: React.ReactNode` and helpers declare return types. Add them when exporting new symbols or type-check fails.
- **`noUncheckedIndexedAccess: true`** — array/object index access is `T | undefined`. The `!` non-null assertions throughout (`arr[i]!`) are deliberate and Biome's `noNonNullAssertion` is turned off to allow them.
- **Path alias `@/*` → `src/*`** exists but is used inconsistently (`index.tsx` uses `@/...`, most files use relative imports). Match the file you're editing.
- **Formatting** is Biome-owned: single quotes, no semicolons (`asNeeded`), 2-space indent. Note `.editorconfig` says tabs but Biome's `indentStyle: space` wins for code; let `bun run lint:fix` format.
- **Unit tests** live under `bun test` and cover the pure cores (field, sampler, simulate, render, settle, clock). DOM/React-bound code (rasterize, engine, backends, component) is exercised manually through the `test/ui` playground.
