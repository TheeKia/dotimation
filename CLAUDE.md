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

The whole library is one data flow from source content to animated pixels. Understanding these stages (and the two coordinate systems / two buffers) is the key to working here.

1. **Rasterize → sample particles** — `initParticles` in `src/utils/utils.ts` (async). Draws the `AnimateItem` (text or image) onto an offscreen canvas, then walks the pixel buffer on a grid (`pointSpacingCss` step) and emits a `Particle` for every pixel whose alpha exceeds `alpha`. Each particle stores its `home*` target position/color. The array is Fisher–Yates shuffled so morph transitions look organic. Text auto-sizing lives in `src/utils/font.ts` (`AUTO` = glyph-weighted heuristic, `AUTO_MONO` = monospace blend).

2. **Recompute on change** — `useInitialParticles` (`src/hooks/use-initial-particles.ts`) reruns `initParticles` only when `item` (shallow-compared) or `width`/`height` change. An `executionId` ref guards against stale async results landing out of order.

3. **Reconcile old → new layout** — `reconcileParticles` and friends in `src/components/dotimation.tsx`. The component keeps two live buffers in refs: `particlesRef` (the active dots) and `intermediateRef` (surplus dots fading out). When the new target is larger it clones extra particles seeded from existing ones (fly-in); when smaller it moves the overflow into the intermediate buffer (fade-out). All mutations are in place so the running animation loop never restarts.

4. **Animate** — `animateParticles` in `src/animations/fps.ts`. A fixed-timestep loop (90 Hz physics via an accumulator, capped at `maxStepsPerFrame`) integrates a critically-damped spring pulling each particle toward its `home` position, plus color lerp, opacity fade, and small jitter. Rendering bypasses canvas draw calls: it writes packed RGBA directly into an `ImageData` `Uint32Array` view with manual alpha compositing, then `putImageData`. Driven by `requestAnimationFrame`; an `AbortController` (from the component's effect) stops the loop on unmount/change.

### Coordinate systems & DPR

Everything tracks two coordinate spaces. Particle positions are in **CSS pixels**; the canvas backing store is **device pixels** (`width * dpr`). `dpr` is `min(devicePixelRatio, 2)` and must be computed the same way everywhere it appears (`getCtx`, `initParticles`, the render loop). `getCtx` sets the canvas size and an initial transform; the animation render loop converts CSS→device per pixel.

## Conventions & gotchas

- **`isolatedDeclarations: true`** (tsconfig) — every exported function/component needs an explicit return type. This is why `Dotimation` is annotated `: React.ReactNode` and helpers declare return types. Add them when exporting new symbols or type-check fails.
- **`noUncheckedIndexedAccess: true`** — array/object index access is `T | undefined`. The `!` non-null assertions throughout (`arr[i]!`) are deliberate and Biome's `noNonNullAssertion` is turned off to allow them.
- **Path alias `@/*` → `src/*`** exists but is used inconsistently (`index.tsx` uses `@/...`, most files use relative imports). Match the file you're editing.
- **Formatting** is Biome-owned: single quotes, no semicolons (`asNeeded`), 2-space indent. Note `.editorconfig` says tabs but Biome's `indentStyle: space` wins for code; let `bun run lint:fix` format.
- **`README.md` is stale**: it claims Dotimation "makes use of react-query" and needs a `QueryClientProvider`. It does not — there is no react-query dependency anywhere. Ignore that note.
- **`test/index.test.ts` is a placeholder** (`true === true`). There is no real unit-test coverage of the particle/animation code yet; the canvas-heavy logic is exercised manually through the `test/ui` playground.
