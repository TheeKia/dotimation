# Expansion readiness review — 2026-09-19

Reviewed the React lifecycle, raster workers/caches, particle reconciliation and simulation, all three render backends, package output, tests, CI, and contributor guidance. The baseline passed 161 tests, type checking, and lint despite the defects below. Fixes are in the working tree; no public prop API was removed or renamed.

## Findings and fixes

| Priority | Finding and user-visible consequence | Resolution / relevant code |
| --- | --- | --- |
| P1 | `sizeCanvas` overwrote `fill`'s percentage CSS with pixels, pinning the canvas to zero or an old parent size. Zero-size Canvas2D initialization also threw when allocating ImageData. | React owns CSS; the helper changes only buffer dimensions. Canvas2D and WebGPU tolerate zero-size surfaces. `src/utils/utils.ts`, `src/backends/canvas2d/index.ts`, `src/backends/webgpu/index.ts`. |
| P1 | A GPU failure after acquiring a context made the entire fallback cascade fail: a canvas cannot switch context types. | `BackendRetryError` advances the cascade by asking the component to mount a fresh canvas. Cancelled effects do not trigger fallback. `src/engine/select.ts`, `src/components/dotimation.tsx`. |
| P1 | Offscreen or suspended zero-jitter animations could exhaust their wall-clock deadline without advancing physics, then remain blank or unfinished. GPU faders likewise expired while paused. | Settle budgets and fader expiry advance with simulated time; pending work resumes on visibility. `src/engine/engine.ts`, GPU backend `index.ts` files. |
| P1 | The sleep budget ignored exponential color easing. Even the default roughly 1.5-second budget could freeze a black-to-white morph visibly short of its target. | Include worst-case color convergence to the shared half-channel tolerance. Canvas2D can still sleep earlier when its field actually settles. `src/engine/settle.ts`, `src/engine/rest.ts`. |
| P1 | A resize during asynchronous initialization updated the DOM canvas but not the backend's cached viewport/buffer dimensions. The completion check saw the already-correct canvas size and skipped synchronization. | Always synchronize backend dimensions after initialization, alongside current simulation params. `src/components/dotimation.tsx`. |
| P1 | GPU restoration uploaded stale CPU positions/alpha; initial CPU alpha stays zero while GPU simulation runs. A sleeping engine could therefore remain blank after restoration. | Snap the authoritative targets and perform a full upload before the restoration draw. `src/backends/webgl2/index.ts`, `src/backends/webgpu/index.ts`. |
| P2 | WebGPU initialization could leak a device on configuration failure or bind a canvas after the owning effect was cancelled. Synchronous pipeline creation did not surface asynchronous validation errors to fallback. | Cancellation checks around adapter/device acquisition, cleanup on failure, and a validation error scope. `src/backends/webgpu/device.ts`, `src/backends/webgpu/index.ts`. |
| P2 | Failed fragment compilation leaked the successfully compiled vertex shader and allocated program. | Release all partially created shader/program resources. `src/backends/webgl2/gl.ts`. |
| P2 | Canvas2D truncated negative coordinates toward zero, unlike GPU floor rounding, producing stray edge pixels. Large dot sizes iterated the entire offscreen footprint and could stall the main thread. | Consistent floor rounding and loops clipped to visible bounds. `src/backends/canvas2d/render.ts`. |
| P2 | Invalid `maxDpr` values propagated zero, negative, or non-finite density into allocation/rasterization. | Invalid caps and device ratios resolve to valid defaults. `src/utils/utils.ts`. |
| P2 | A failed, evicted image request could later delete a newer cached request for the same URL. Raster jobs continued publishing/processing after unmount. | Identity-checked cache deletion and lifecycle invalidation of in-flight/queued raster jobs. `src/utils/async-lru.ts`, raster loaders, `src/hooks/use-field-targets.ts`. |
| P2 | Worker constructor failures leaked Blob URLs; synchronous postMessage failures retained pending timers; a timed-out worker remained reusable. Relative image URLs were interpreted outside the document's base URL. | Finally-based URL cleanup, pending-request cleanup, terminate on timeout, and document-based URL resolution before posting. `src/raster/rasterize-worker.ts`. |
| P2 | Font readiness checks used default sample text, missing unicode-range subsets. Empty lines forced AUTO font sizing down to 10px; non-finite monospace widths could produce NaN. | Check/load actual text; ignore blank lines only in the width heuristic (height still counts them); validate monospace widths. `src/hooks/use-font-epoch.ts`, `src/utils/font.ts`. |
| P2 | Public API type assertions were never compiled by any repository check. | Add `test/tsconfig.json` to `bun run type-check`; unit tests and public prop assertions now compile in CI. |
| P3 | Every component render allocated and discarded fourteen 1,024-element arrays in the argument to useRef. GPU hash conversion could round up to 1.0 despite its documented exclusive bound. | Lazy initial field allocation; truncate GPU hash to 24 bits before f32 conversion. Component and simulation shaders. |
| P3 | Formatter settings conflicted, contributor commands were stale, e2e could use stale generated worker code, and distribution validation ran only before publication. | Align EditorConfig, refresh contributor instructions, regenerate workers before e2e, and add distribution checks to CI. Migrate active guidance to AGENTS.md. |

## Verification

- Unit tests: 174 passing, including visibility/suspension timing, color convergence, clipping, cache replacement, invalid density, font sizing, WebGPU acquisition cleanup/cancellation, and WebGL compilation cleanup.
- Type checking: library plus unit/public API type fixtures.
- Biome lint and `git diff --check`.
- Library build and `scripts/check-dist.ts` (browser output and intact export bundle).
- Playground TypeScript and production build.
- Chromium browser suite: existing rendering/motion checks plus fill resizing, zero-size recovery, StrictMode, context-bound fallback, WebGL restoration without an engine wake, and deterministic resize during delayed initialization.

## Remaining validation and expansion work

This review does not establish that the project is defect-free. WebGPU compute/render behavior is now exercised with real pipelines and texture readback on SwiftShader and the available Metal adapter. Acquisition/cancellation unit tests still use API doubles, and the delayed-startup browser test deliberately substitutes a backend. WebGPU device-loss recovery, a broader hardware matrix, and Safari/Firefox remain validation gaps before expanding GPU behavior or browser support.

The sampler still allocates candidates for the full sampling grid before applying `dots.max` (zero max now exits immediately). The cap limits output particle count, not raster memory or scan cost. Benchmark large images and many simultaneous instances before selecting expansion limits; bounded-memory sampling would be a separate algorithm change.

The component continues to coordinate measurement, rasterization, backend creation, motion updates, and accessibility in one module. The added lifecycle tests provide a safer basis for extracting backend ownership into a hook if additional backends or lifecycle features are introduced. Such extraction was not necessary for these fixes.

Historical design/implementation plans retain their original references to CLAUDE.md. AGENTS.md is the current repository guidance; active source comments and contributor links use it.


## Second pass

The follow-up audit found and fixed three further behavior defects:

1. **Slow morphs could freeze before reaching the target.** With `settleTime: 10`, a particle moving from x=0 to x=1000 stopped at x=983.9459 when the approximate budget expired. The engine now snaps the authoritative final state and performs a full backend upload before sleeping. A failing-then-passing simulation regression verifies this.
2. **Changing fade speed could prematurely remove GPU faders.** An elapsed-time threshold derived from the new rate incorrectly treated earlier time as though it had used that rate. Both GPU backends now integrate actual opacity loss (`dt * opacityRate`). The browser regression renders 2,048 particles, shrinks to one, changes fade from 0.1 to 10, and verifies all still-visible faders survive before eventually disappearing. This failed on WebGL before the fix and passes on both backends afterward.
3. **A transient image failure did not retry when raster dependencies retained their identities.** Clearing the previous-input ref was insufficient because React skipped the dependency-bound effect. The effect now checks each commit and relies on the existing shallow comparison to avoid redundant successful rasterization. The browser test fails one decode, preserves the image object, and verifies retry after an unrelated className update.

WebGPU recovery cleanup also now releases partially created replacement-device resources on failure and centralizes teardown. Device-loss recovery itself still needs broader hardware validation.

Verification now includes actual WebGPU shader execution, buffer growth, full state uploads, fade transitions, and texture readback, alongside WebGL. Focused checks passed using both SwiftShader and the host's available Metal adapter. The initial WebGPU canvas readback failure was reproduced in a standalone browser-only test and resolved by explicitly selecting the graphics adapter; it was a test-launch configuration issue.

The unit total remains 174: the obsolete duration-helper test was replaced with the new slow-morph regression. The complete browser suite additionally includes the GPU and image-retry regressions. Type checks, lint, library and playground builds, distribution validation, and diff whitespace checks were rerun for this pass.
