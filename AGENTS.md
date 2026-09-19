# AGENTS.md

Repository guidance for coding agents and contributors working in this project.

## Workspace and packages

`dotimation` renders text and images as animated dots on a canvas. This Bun workspace has three ESM-only packages:

- `packages/core` → `@dotimation/core`: framework-independent simulation, rasterization, backends, and browser runtime.
- `packages/react` → `dotimation`: React 19 adapter. Existing imports and previously exported types remain compatible.
- `packages/svelte` → `@dotimation/svelte`: Svelte 5 adapter (minimum 5.29 for attachments).
- `apps/playground-react` and `apps/playground-svelte`: source-linked Vite development apps.
- `test/e2e`: Chromium scenarios shared across adapters; `test/fixtures/browser`: common lifecycle driver and real GPU checks.
- `test/fixtures/consumers`: isolated package consumers used to verify the actual tarballs, without source aliases.

The root is private. Both adapters depend on core with `workspace:*`; packing rewrites that to the core version. Publish core before the adapters and keep their versions synchronized. The root's version is not a published package version.

Dependencies flow adapters → core. Core must never import a framework. Adapters import only the core package entry point, never its internal files. Internal core imports are relative. Vite aliases are development-only; distribution tests must use package exports.

## Commands

Bun is the only supported toolchain. Do not use npm/yarn/pnpm.

- `bun install` — links workspaces, installs dependencies, sets hooks, generates the worker source.
- `bun run dev` / `bun run dev:svelte` — React / Svelte source-linked playgrounds; no package build needed.
- `bun run build` — generates the worker, builds core and React with browser-targeted bunup, then Svelte with `svelte-package`.
- `bun run check:dist` — validates exports, browser output, React's client directive, Svelte sources, and package versions.
- `bun run type-check` — library, unit/public API fixtures, test tooling, and Svelte component diagnostics.
- `bun run lint` / `bun run lint:fix` — Biome for TS/JS/config; Prettier with the Svelte plugin for `.svelte` files. Svelte semantic checks run through `svelte-check`.
- `bun test`, `bun test packages/core/test/runtime`, `bun run test:watch`, `bun run test:coverage` — unit tests. Workspace TS paths resolve core source for Bun tests.
- `bun run test:e2e` — both adapters in headless Chromium. Install Chromium once with `bunx playwright install chromium`.
- `DOTIMATION_E2E_FRAMEWORK=svelte bun test/e2e/smoke.e2e.ts` — one adapter; React is the default.
- `DOTIMATION_E2E_GPU_ONLY=1 bun run test:e2e` — real GPU parity only. `DOTIMATION_E2E_ANGLE=metal` selects Metal on a supported host; default is SwiftShader.
- `bun run test:packages` — after building, packs all libraries and installs independent React and Svelte consumers in temporary directories. Checks declarations, production bundling, SSR/hydration, and browser rendering. Requires Chromium and package registry access/cache. The unpublished core is explicitly overridden with its tarball; no workspace/source resolution is used.
- `bun run --cwd apps/playground-react build` / `bun run --cwd apps/playground-svelte build` — playground type checks and production builds.

Pre-commit runs lint + type-check. CI checks build, distribution, types, lint, unit tests and playground builds on Linux/macOS/Windows. Browser and packed-consumer tests run on Linux.

## Runtime ownership

`packages/core/src/runtime/controller.ts` owns canvas sessions through `createDotimationController` (exported from core):

1. `update(options)` stores a complete value snapshot. Motion and dot-size changes update the live engine; raster inputs are compared by value. Updates must not be keyed only on object identity.
2. `connect(canvas)` starts a session and returns its cleanup. Construction and imports are SSR-safe; browser resources are acquired only on connection. An old cleanup cannot stop a newer session.
3. The host's `replaceCanvas()` callback requests a fresh framework-owned element. Backend, density, reduced-motion changes, and backend fallback terminate the previous session before requesting replacement. The runtime never replaces framework DOM directly.

React uses committed layout effects and a keyed canvas. Svelte uses a keyed attachment for connection and a separate effect for updates, with `untrack` around imperative runtime calls. Nested Svelte option values are read before entering `untrack`, so in-place proxy updates are observed. Both adapters own CSS dimensions, accessibility attributes, classes/styles and native element references (`ref` in React, `bind:canvas` in Svelte).

The session owns an AbortController, engine, field, ResizeObserver, font watcher and environment listeners. Late backend initialization is disposed; stale raster results never publish. Size and params are reapplied after async startup even if the DOM was already resized. Empty content or a zero-sized box publishes a zero-particle layout.

`runtime/raster.ts` owns worker-first fallback and latest-wins scheduling (one in flight, newest queued). It snapshots caller inputs, invalidates queued/in-flight results on cleanup, and forgets failed inputs so a subsequent update can retry unchanged content. `runtime/environment.ts` owns DPR, reduced-motion and font subscriptions. Each resource has explicit cleanup.

## Particle pipeline (inside packages/core/src)

### Rasterization

`raster/` draws source content, samples pixels and produces `FieldTargets`. `scripts/build-worker.ts` bundles `raster/raster.worker.ts` into gitignored `raster/worker-source.ts`; the worker ships as a Blob source string and needs no consumer bundler configuration. Do not commit the generated file.

`worker-safe.ts` keeps custom fonts on the main thread. Workers have a separate font set. Every worker failure falls back to main-thread rasterization. Both paths use small promise LRUs for decoded images; image bitmaps close on eviction. Failed image loads evict only their own promise, never a replacement. Resolve image URLs against `document.baseURI` before posting to a Blob worker. Construction failures revoke Blob URLs; posting failures remove pending requests; timeouts terminate the worker. Workers self-terminate after about 10 seconds idle.

`raster/inputs.ts` compares every raster input: shallow item values, dimensions, default font family, threshold/spacing/max, density and font epochs. `raster/sample.ts` samples the grid and caps output; the cap does not bound candidate-allocation memory. `raster/draw.ts` clamps auto font sizing to width and multiline height. `utils/font.ts` implements AUTO/AUTO_MONO heuristics.

Font readiness uses the actual text (unicode-range subsets), skips generic/already-loaded families, and rerasterizes only when `document.fonts.load` returns matching faces. A no-face result does not trigger a reraster.

### Field and engine

`engine/field.ts` stores particles as Float32Array structures of arrays. Slots `[0, active)` are the layout; `[active, count)` are outgoing faders. Capacity grows to powers of two. Shared structural contracts live in `engine/types.ts`; public content/stats types live in `types.ts`, which retains explicit compatibility type reexports.

Reconciliation and Morton matching use **home positions**, never live simulated x/y, because CPU positions are stale under GPU simulation. Spawn slots use their just-written spawn position as the ordering key. `engine/reconcile-plan.ts` is the shared pure planner for CPU and GPU state synchronization. `snapField` must be followed by a full state upload (`setField(field, true)`).

`engine/engine.ts` owns rAF, IntersectionObserver gating and a 90 Hz accumulator (`clock.ts`). Positive jitter runs continuously while visible and nonempty. Zero jitter sleeps when settled or when its simulated-time budget expires. Paused/offscreen time and discarded frame deltas never consume that budget. Always draw each running frame, even with zero physics steps. Before sleeping, snap authoritative targets and upload the full state to avoid an unfinished morph.

`engine/params.ts` is the single source for option defaults, sanitization and derived `SimParams`. `toSimParams` is the only call site for spring tuning. Inputs clamp or fall back silently; MIN_SETTLE_TIME/MIN_DAMPING preserve integrator stability. Settle budgets cover position, opacity and worst-case color convergence. `engine/rest.ts` is the shared slot-rest predicate.

### Backends

The common interface is `init / uploadField / setParams / step / draw / resize / dispose`, with optional `settled`.

- Canvas2D: pure SoA simulation and bounded pixel-push rendering. Settled reporting is fused into the simulation step.
- WebGL2: transform-feedback simulation and instanced quads.
- WebGPU: WGSL compute over storage buffers and instanced quads. Validation scopes surface asynchronous pipeline errors during startup.

`backends/gpu-shared.ts` owns shared buffer layout, QUAD, packers, scratch growth and fader thresholds. Fader expiry integrates `dt * opacityRate` across actual rate changes; never recalculate earlier loss using a new rate.

`engine/select.ts` performs an async cascade, auto starting with the supported subset of WebGPU → WebGL2 → Canvas2D. GPU modules load dynamically. A failed GPU init throws `BackendRetryError`; acquiring a context permanently binds a canvas to that type, so fallback requires a fresh canvas. Cancellation must prevent late canvas binding, leaked devices and unintended fallback.

GPU recovery snaps the last uploaded CPU field and repaints immediately with a full upload. CPU alpha and positions are stale under GPU simulation; uploading them unchanged can leave a sleeping engine blank. Dispose partially created resources after failures.

## Rendering and API invariants

- Particle positions and dot sizes are CSS pixels; buffers are device pixels. DPR is `min(devicePixelRatio, maxDpr)` (default cap 2), with safe defaults for invalid input.
- All backends use premultiplied source-over, `floor(x * dpr + 0.5)` position snapping (including negatives), and `max(1, round(dotSize * dpr))` footprints.
- `dots.size: 'hairline'` resolves to the internal zero sentinel, producing exactly one device pixel. Numeric zero still falls back to the default.
- `sizeCanvas` writes only guarded backing dimensions. Reassigning even an unchanged canvas dimension clears pixels. Adapters alone own CSS dimensions; no JSX/Svelte width/height attributes.
- Zero size is valid. Do not allocate zero-size ImageData or present zero-size WebGPU textures. Clamp Canvas2D footprint loops to visible bounds.
- Reduced motion forces zero jitter and completes morphs instantly with a snap/full upload. Prop overrides OS preference; a live effective change replaces the canvas.
- `fill` is mutually exclusive with fixed width/height. Motion/size changes preserve the canvas and simulation; matching changes apply at the next reconcile.
- `onStats` reports the resolved backend and active particle count on startup and target updates. Use the latest callback after async work.
- PRNG outputs are strictly `[0, 1)`: CPU divides by 2^32; GPU uses 24 hash bits before f32 conversion.

## Conventions and validation

- `isolatedDeclarations: true` applies to core/React. Exported functions need explicit return types. Svelte declarations are generated by `svelte-package` and checked with `svelte-check`.
- `noUncheckedIndexedAccess: true`; deliberate non-null assertions are allowed. Use single quotes, no semicolons and two-space indentation.
- Root `test/tsconfig.json` must continue compiling unit/public API fixtures and test tooling. Packaged consumers check generated declarations without workspace aliases.
- Do **not** add `sideEffects: false`: the existing bunup configuration has previously produced a gutted bundle with that setting. The distribution check guards core size and expected output.
- Never run bare `bunup`: it defaults to node and can emit `node:module` shims. Use `bun run build`. Each publishable package's prepublish hook rebuilds and validates all output.
- Preserve React's `use client` directive in the distributed entry. Svelte ships preprocessed `.svelte` files with `types`/`svelte` export conditions, not precompiled application output.
- Shared runtime tests cover scheduling, cancellation, retries and startup races. Browser suites cover actual fill/zero-size behavior, React StrictMode, Svelte bindings, fallback, reduced motion, GPU restoration and real render/compute parity. Do not replace actual GPU checks with doubles.
- `docs/superpowers/` and `docs/code-review-2026-09-19.md` are historical; their old paths describe earlier layouts. `docs/architecture.md` describes the current boundaries and release process.
