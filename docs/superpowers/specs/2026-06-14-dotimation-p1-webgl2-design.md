# Dotimation P1 — WebGL2 Backend Design Spec

**Date:** 2026-06-14
**Status:** Approved design (parent), pending P1 sign-off
**Depends on:** P0 (CPU re-architecture, merged). Parent design:
`2026-06-14-dotimation-perf-rewrite-design.md`.

## Summary

P0 shipped the engine, the SoA `ParticleField`, the unified morph (`reconcile`), and a
Canvas2D backend behind the `Backend` interface. P1 adds the **WebGL2 backend**: the
~98%-available GPU tier. Per the locked decisions, it runs **the simulation on the GPU via
transform feedback** and **renders dots as instanced quads**, hitting ~250k particles at
60fps while preserving the smooth morph, settle/sleep, and `dotSize` behavior.

The `Backend` interface is unchanged. The new work is: a WebGL2 program pair (simulate +
render), a GPU-resident state model that stays structurally consistent with the CPU
`ParticleField` across reconciles **without GPU→CPU readback**, async backend selection with
dynamic `import()`, and graceful fallback to Canvas2D.

## Goals & success metrics

| Metric | Target |
| --- | --- |
| Throughput (WebGL2, mid-tier laptop) | 60fps at ~250k particles |
| Visual parity with Canvas2D | smooth morph, settle/sleep, fade in/out, `dotSize`, shimmer all match within tolerance |
| Selection | `backend='auto'` picks WebGL2 when available; `'webgl2'` forces it; init failure or no WebGL2 → Canvas2D |
| Bundle | WebGL2 backend loaded via dynamic `import()` — Canvas2D-only users never download it |
| Robustness | WebGL2 context-loss does not crash the app |
| Tests | pure helpers (clip transform, reconcile delta) unit-tested; GL path verified in the playground |

Non-goals: WebGPU (P2), worker rasterization / benchmark harness / `maxParticles` (P3),
runtime auto-tier-down mid-session after context loss (best-effort restore only this phase).

## Architecture

### Module layout (new)

```
src/backends/webgl2/
  index.ts        # createWebGL2Backend(opts) → Backend (orchestrates the below)
  gl.ts           # context creation, shader/program compile helpers, error checks
  program-sim.ts  # transform-feedback simulation program (GLSL + attribute/varying wiring)
  program-draw.ts # instanced-quad render program (GLSL)
  buffers.ts      # ping-pong state buffers, home/target buffer, unit-quad, (re)allocation
  shaders/
    sim.vert.ts   # simulation vertex shader source (string)
    draw.vert.ts  # render vertex shader source (string)
    draw.frag.ts  # render fragment shader source (string)
src/engine/
  reconcile-plan.ts  # NEW pure FieldDelta planner (shared by reconcile + webgl2 sync)
  field.ts           # reconcile refactored to use reconcile-plan (behavior unchanged)
  select.ts          # async, capability-gated, dynamic import of webgl2
  viewport.ts        # NEW pure CSS-px → clip-space transform helpers
```

### GPU state model

Particle state is split into two categories, mirroring how transform feedback works
(evolving state is captured; targets are read-only inputs):

- **Evolving state** (written by the sim each step) — kept in two ping-pong VBOs
  (`stateA`, `stateB`), interleaved per particle: `[x, y, vx, vy, r, g, b, alpha]`
  (8 × float32 = 32 bytes). One is the read source, the other the TF capture target;
  they swap every step.
- **Targets** (constant between reconciles) — one `targets` VBO:
  `[homeX, homeY, homeR, homeG, homeB, targetAlpha]` (6 × float32 = 24 bytes). Re-uploaded
  on `uploadField`.

`count` (live slots) and `capacity` (allocated) track the CPU field. Buffers are allocated
to `capacity` (power-of-two) and reallocated only on growth, never shrunk mid-session.

### Simulation pass (transform feedback)

`step(dt)` runs the sim program once with the rasterizer discarded:

1. Bind the **read** VAO: evolving-state attributes from the current state buffer + target
   attributes from the `targets` buffer.
2. Bind the **other** state buffer as the transform-feedback target.
3. `enable(RASTERIZER_DISCARD)`, `beginTransformFeedback(POINTS)`,
   `drawArrays(POINTS, 0, count)`, `endTransformFeedback()`, `disable(RASTERIZER_DISCARD)`.
4. Swap read/write state buffers.

The sim **vertex shader** integrates one fixed step, identical math to P0's `stepField`:
- semi-implicit Euler spring toward `homePos` with uniforms `uK`, `uC`, `uDt`
- exponential color ease toward `homeColor` (`uColorRate`)
- alpha eased toward `targetAlpha` (`uOpacityRate`)
- X-only jitter gated to ~15Hz: backend passes `uJitter` (amount or 0) and `uSeed`; the
  shader derives a per-particle pseudo-random from `gl_VertexID` + `uSeed`.
Captured varyings (interleaved): `[x, y, vx, vy, r, g, b, alpha]` matching the state layout.

Spring/rate constants come from `src/engine/constants.ts` (shared with Canvas2D), passed as
uniforms — no drift between tiers. Fader compaction (P0 did it on CPU) is handled here by
**not drawing** dead faders: the sim leaves them, and `count` shrinks via the reconcile plan
(below) when the controller next reconciles. (Per-step GPU compaction is unnecessary at P1's
scale; faders simply fall out of `count` on the next reconcile, same as P0's effective result.)

### Render pass (instanced quads)

A static unit-quad VBO (4 verts, triangle strip). Per-instance attributes (divisor 1) read
from the **current** state buffer: `pos`, `color`, `alpha`. Each frame:
1. `clear` to transparent.
2. `enable(BLEND)`, `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` (straight-alpha source-over).
3. `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, count)`.

The render **vertex shader** places each quad: `clip = viewport(instancePos + corner *
dotSizeDev)`, where `dotSizeDev = dotSize` device px (matching P0's square footprint) and
`viewport` maps CSS-px → clip space using `uDevW`, `uDevH`, `uDpr` uniforms (Y flipped). The
**fragment shader** outputs `vec4(color/255, alpha)` — hard-edged square, no AA, for parity
with the Canvas2D look. Instances draw in slot order; blending composites them like P0's
in-order manual blend (close, see Risks).

### The hard part: reconcile → GPU sync without readback

The GPU owns the evolving state after the first step, so the CPU field's `x/y/vx/vy/alpha`
go stale. To keep smooth morphs (kept particles must retain their **live GPU** positions
across a content change) without a GPU→CPU readback, `uploadField(field)` applies a
**structural delta** to the GPU buffers instead of blindly re-uploading state:

Introduce a pure planner reused by both backends:

```ts
// src/engine/reconcile-plan.ts
export interface FieldDelta {
  active: number          // new active count
  count: number           // new total (active + surviving faders)
  overlap: number         // slots [0, overlap) kept & retargeted (state preserved)
  relocate: { from: number; to: number; len: number } | null  // fader move on growth
  spawn: { start: number; end: number } | null  // new active slots needing state init
  firstLoad: boolean
}
export function planReconcile(prevActive: number, prevCount: number, newActive: number): FieldDelta
```

`reconcile` (P0) is refactored to compute the same delta and apply it to the CPU SoA — its
external behavior and tests stay green. The WebGL2 backend applies the delta to GPU buffers:

- **`targets` buffer:** always re-uploaded in full from `field.home*`/`targetAlpha` (cheap,
  authoritative, changes every reconcile).
- **Overlap `[0, overlap)`:** GPU state left untouched → live positions preserved → smooth
  morph. ✓
- **Shrink:** surplus actives become faders purely via `targetAlpha → 0` in the re-uploaded
  `targets` buffer; their GPU state is untouched and keeps fading. ✓
- **Growth fader relocation** (`relocate`): move the GPU evolving-state region on-GPU with
  `copyBufferSubData` (no readback) in the current state buffer.
- **Spawned actives** (`spawn`): initialize just those slots' evolving state via
  `bufferSubData` — seed position from a believable origin (the home of an existing slot, so
  new dots fly in from the old shape), `vel = 0`, `color = home color`, `alpha = 0`.
- **First load:** initialize all `count` slots' evolving state from the CPU field directly
  (positions at home, `alpha = 0`); upload `targets`.

This preserves P0's exact morph semantics on the GPU. The planner is pure and unit-tested;
the GPU buffer ops are verified visually.

### Async backend selection + dynamic import

`select.ts` becomes async to support code-split backends:

```ts
export async function selectBackend(opts: SelectOptions): Promise<Backend>
```

- Resolve kind via `resolveBackendKind` (P0).
- `webgl2` → `await import('@/backends/webgl2')`, probe a real context; on any failure log
  and fall back to `createCanvas2DBackend`.
- `canvas2d` → construct directly (no dynamic import needed; it's the always-present tier).

The React component's engine-creation effect becomes async-aware: it kicks off
`selectBackend(...)`, and in the `.then` (guarded by a `cancelled` flag set in cleanup)
calls `backend.init`, creates the engine, and seeds the latest targets. Cleanup disposes
whatever exists. This avoids races when geometry/backend props change rapidly.

### Context loss / fallback

- **Init-time** (no WebGL2, or `getContext('webgl2')` returns null, or program compile
  fails): `select.ts` falls back to Canvas2D. Users on the ~2% without WebGL2 are unaffected.
- **Runtime `webglcontextlost`:** `preventDefault()` to allow restore; mark the backend
  inert so `step`/`draw` become no-ops until `webglcontextrestored` reinitializes GL
  resources. The animation pauses rather than crashes. (Automatic tier-down to Canvas2D on
  unrecoverable loss is deferred; P1 guarantees no crash.)

## Visual parity

The Canvas2D tier is the reference. Differences to manage:
- **Compositing:** P0 does straight-alpha source-over per pixel in slot order on the CPU;
  WebGL2 uses fixed-function `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` in instance order. Order matches
  (slot order); results should match within rounding. Verify overlapping/translucent dots.
- **Sub-pixel placement:** P0 snaps to device pixels (`| 0`); the quad path is continuous.
  For parity, snapping in the render vertex shader is optional — evaluate by eye; continuous
  likely looks equal-or-better. Keep `dotSize` device footprint identical.
- **Jitter:** same amount, X-only, ~15Hz gate, shared constant.

## Testing

GL can't run under `bun test` (no headless context here). Strategy:
- **Unit-tested pure helpers:** `planReconcile` (delta correctness across first-load / shrink
  / growth / fader-relocate / capacity-grow), and `viewport.ts` CSS-px→clip transforms
  (corners, Y-flip, dpr). These are the bug-prone parts and they get real coverage.
- **Playground verification** (`test/ui`): `webgl2` backend button, FPS overlay, stress
  preset (a high-particle item) to confirm the throughput target, plus parity spot-checks
  against `canvas2d` (toggle and compare morph/settle/dotSize). Document the manual checklist
  in the plan.

## Phasing within P1 (each independently committable)

1. Pure helpers: `viewport.ts` + `reconcile-plan.ts` (+ refactor `reconcile` onto it). Tested.
2. GL scaffolding: `gl.ts` context/compile helpers; `buffers.ts` allocation + ping-pong.
3. Render pass first (instanced quads) driven by CPU-uploaded state — proves the draw path
   and viewport math visually before TF.
4. Simulation pass (transform feedback) — swap CPU stepping for GPU stepping.
5. Reconcile→GPU sync (delta application: relocate/spawn/targets).
6. Async `select.ts` + dynamic import + component async handling + context-loss guard.
7. Playground `webgl2` option + stress preset; docs (CLAUDE.md backend section).

## Risks & mitigations

- **TF varying/attribute limits** at high counts → interleave state into one buffer (8
  floats) to stay within `MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS`; validate on target
  hardware.
- **State/CPU divergence** (the readback-free sync is the riskiest logic) → the `planReconcile`
  delta is pure and unit-tested; the backend applies it deterministically; parity verified in
  the playground.
- **Compositing differences** vs Canvas2D → pin by eye against the reference; accept small
  rounding deltas.
- **Async selection races** (props change before import resolves) → `cancelled` guard in the
  effect cleanup; dispose-before-reinit.
- **Context loss** → no-op while lost + restore handler; documented best-effort.
- **Driver variance** in instanced rendering / TF → stick to core WebGL2 features, no
  extensions.

## Open questions for the plan

- Interleaved vs separate TF varyings — default interleaved (one state buffer, simplest
  ping-pong); revisit only if a component-limit is hit.
- Whether to device-pixel-snap quad positions for exact Canvas2D parity — decide by eye in
  step 3.
- Seed origin for spawned actives (own home vs a neighbor's home) — pick whichever reads best
  for fly-in; default to a neighbor slot's home as P0 does.
