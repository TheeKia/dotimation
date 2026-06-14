# Dotimation P2 — WebGPU Backend Design Spec

**Date:** 2026-06-14
**Status:** Pending P2 sign-off
**Depends on:** P0 (Canvas2D) + P1 (WebGL2), both merged. Parent design:
`2026-06-14-dotimation-perf-rewrite-design.md`.

## Summary

P0 shipped Canvas2D, P1 shipped WebGL2 (transform-feedback physics + instanced quads). P2
adds the top tier: **WebGPU**, running the simulation in a **WGSL compute shader** over
storage buffers and rendering instanced quads, targeting **1M+ particles at 60fps**. It
completes the three-tier cascade **WebGPU → WebGL2 → Canvas2D** and reuses everything shared:
the pure `planReconcile`/`FieldDelta` planner, `viewport`, `constants`, and the SoA
`ParticleField`. The `Backend` interface is unchanged.

P2 also lands one piece of architecture P1 deferred: a proper **fallback cascade**. Today the
component falls straight to Canvas2D if a GPU backend's `init` throws; with three tiers we want
WebGPU failure to try WebGL2 before Canvas2D. P2 centralizes async construct-and-init into an
ordered cascade.

## Goals & success metrics

| Metric | Target |
| --- | --- |
| Throughput (WebGPU, discrete/modern integrated GPU) | 60fps at 1M+ particles |
| Visual parity | morph, settle/sleep, fade, `dotSize`, shimmer match Canvas2D/WebGL2 within tolerance |
| Selection | `backend='auto'` picks WebGPU when an adapter exists; cascades WebGPU→WebGL2→Canvas2D on any failure; explicit `'webgpu'` tries WebGPU then safety-nets to Canvas2D |
| Bundle | WebGPU backend dynamic-import code-split (own chunk), like WebGL2 |
| Robustness | no adapter / `device.lost` → cascade or no-op, never a crash |
| Tests | reuses tested pure helpers; the new pure cascade-order helper is unit-tested; WGSL/pipeline code is playground-verified (no headless WebGPU here) |

Non-goals: P3 items (worker rasterization, benchmark harness, `maxParticles` enforcement, the
two deferred WebGL2 parity nits). Mid-session re-tier on device loss beyond best-effort is out.

## Tooling prerequisite

WebGPU TypeScript types are **not** reliably in the `DOM` lib. Add `@webgpu/types` as a
devDependency and reference it (tsconfig `compilerOptions.types: ["@webgpu/types", ...]` or a
triple-slash directive in the backend entry). This is the first plan task; without it the
backend won't type-check.

## Architecture

### Module layout (new)

```
src/backends/webgpu/
  index.ts        # createWebGPUBackend(opts) → Backend (async init)
  device.ts       # adapter/device acquisition + canvas context configuration
  buffers.ts      # storage ping-pong state, targets, uniforms, quad; capacity growth
  pipelines.ts    # compute pipeline + render pipeline + bind group layouts
  shaders/
    sim.wgsl.ts   # compute shader source (WGSL string)
    draw.wgsl.ts  # vertex + fragment source (WGSL string)
src/engine/
  cascade.ts      # NEW pure backend-order helper (resolveBackendOrder) — unit-tested
  select.ts       # refactored: async ordered construct-and-init cascade
```

### GPU state model

Same SoA split as WebGL2:
- **Evolving state** — two ping-pong storage buffers, interleaved per particle
  `[x, y, vx, vy, r, g, b, alpha]` (8 × f32 = 32 bytes). Buffer usage:
  `STORAGE | VERTEX | COPY_SRC | COPY_DST` (read/written by compute; read as instanced vertex
  data by render; relocated/grown via copies).
- **Targets** — one storage buffer `[homeX, homeY, homeR, homeG, homeB, targetAlpha]`
  (6 × f32 = 24 bytes), usage `STORAGE | COPY_DST`.
- **Uniforms** — a small uniform buffer with sim params (`dt, k, c, colorRate, opacityRate,
  jitter, seed, count`) and render params (`devW, devH, dpr, dotSize`), 16-byte aligned per
  WGSL layout rules. Two uniform regions (sim, render) or one struct.

`count`/`capacity` track the CPU field; buffers sized to `capacity` (pow2), grown with
state preservation (copy old→new), never shrunk.

### Compute pass (simulation)

`step(dt)` records a compute pass: one invocation per particle (`@workgroup_size(64)`,
dispatch `ceil(count / 64)`). The WGSL compute shader reads the current state + targets
storage buffers and writes the next state buffer — identical math to Canvas2D `stepField`
and the WebGL2 sim shader (semi-implicit Euler spring, exp color ease, alpha toward
`targetAlpha`, X-only jitter every step via a `hash(index, seed)`), guarded by
`if (index >= count) { return; }`. Ping-pong: swap which state buffer is "current" each step
(swap bind groups / buffer references).

### Render pass (instanced quads)

A unit-quad vertex buffer (stepMode `vertex`) + the current state buffer bound as instanced
vertex data (stepMode `instance`, attributes pos@0, color@16, alpha@28). The WGSL vertex
shader places a `dotSize`-device-px square at the particle's CSS position mapped to clip
space (Y-flip), matching WebGL2's `draw.vert`. The fragment shader outputs `vec4(color/255,
alpha)`, discarding `alpha <= 0`. Render pipeline blend state = source-over
(`src-alpha, one-minus-src-alpha` for color; `one, one-minus-src-alpha` for alpha — the
correct alpha channel, improving on the WebGL2 nit). The pass clears to transparent each
frame and draws `4` vertices × `count` instances.

### Reconcile → GPU sync (reused design)

Identical strategy to WebGL2, with WebGPU buffer ops:
- `targets`: full re-upload each `uploadField` via `queue.writeBuffer`.
- Overlap state preserved (untouched); shrink = targets-only.
- **Relocate** (growth with faders): clobber-safe rebuild into the other ping-pong buffer via
  `encoder.copyBufferToBuffer`, then swap.
- **Spawn** new slots: `queue.writeBuffer` into the slot range.
- **First load:** write all state.
- **Capacity growth:** allocate larger buffers, `copyBufferToBuffer` the live `[0,count)`
  state across, then dispose old.
- **Fader expiry:** same deterministic time-based drop of `count → active` after the fade
  duration (the compute shader never shrinks count).

The pure `planReconcile`/`FieldDelta` from P1 drives this unchanged.

### Async init + device loss

`init(canvas, dpr)` is async: `navigator.gpu.requestAdapter()` → `adapter.requestDevice()` →
configure the `GPUCanvasContext` (`context.configure({ device, format:
getPreferredCanvasFormat(), alphaMode: 'premultiplied' | 'opaque' })`). If any step fails it
throws, so the cascade tries the next tier. A `device.lost` handler marks the backend inert
(`step`/`draw` become no-ops) so loss never crashes.

### Fallback cascade (`cascade.ts` + `select.ts` refactor)

`resolveBackendOrder(requested, caps)` (pure, tested) returns the ordered tier list:
- `'auto'` → the supported subset of `['webgpu', 'webgl2', 'canvas2d']`
- explicit `'webgpu'`/`'webgl2'` → `[that, 'canvas2d']` (Canvas2D is the always-present safety net)
- `'canvas2d'` → `['canvas2d']`

`select.ts` becomes the async cascade owner: it takes `canvas` + `dpr`, and for each kind in
order **constructs (dynamic import) and `init`s** the backend, returning the first that
succeeds; Canvas2D is last and never throws. This replaces P1's "construct in select, init +
single fallback in component". The component then just `await`s one call and gets a ready
backend — simpler and correct for three tiers.

## Visual parity

Canvas2D remains the reference; WebGPU should match it and WebGL2. The compute math is a
straight translation of `stepField`. The render places the same device-px square. WebGPU's
correct separate alpha blend is a (positive) refinement over the WebGL2 alpha nit; color
source-over matches. Verify overlapping/translucent dots and morphs by eye.

## Testing

Same reality as P1 — no headless WebGPU here:
- **Unit-tested pure helper:** `resolveBackendOrder` (auto subset, explicit + safety net,
  canvas2d-only, capability gating). `planReconcile`/`viewport` already covered.
- **Playground verification:** a `webgpu` backend button, the existing FPS overlay and stress
  preset; parity toggles against `webgl2`/`canvas2d`, and a high-count run to confirm the 1M
  target. Manual checklist in the plan.

## Phasing within P2 (each independently committable)

1. Tooling + pure cascade: add `@webgpu/types`; `cascade.ts` (`resolveBackendOrder`, TDD);
   refactor `select.ts` + component onto the async cascade (works with existing backends —
   WebGPU import simply fails until it exists, cascading to WebGL2).
2. WGSL shaders: `sim.wgsl`, `draw.wgsl`.
3. Device + canvas context (`device.ts`); buffers (`buffers.ts`).
4. Pipelines + bind groups (`pipelines.ts`).
5. Backend wiring (`index.ts`): async init, compute step, instanced draw, reconcile delta,
   capacity growth, fader expiry, device-loss guard.
6. Wire `webgpu` into the cascade/selection + capability detection; playground `webgpu` button;
   docs (CLAUDE.md).

## Risks & mitigations

- **WGSL/pipeline correctness** (verbose, bind-group-heavy) → playground-tuned; the pure
  cascade + reconcile logic is unit-tested; a final read-through review before browser test.
- **Buffer usage flags** (`STORAGE | VERTEX | COPY_SRC | COPY_DST`) must be exact → called out
  in the plan; wrong flags fail validation loudly.
- **Uniform buffer alignment** (WGSL 16-byte rules) → define the struct layout explicitly in
  the plan; pad fields.
- **Compute/render buffer hazards** → compute writes the *next* buffer, render reads the
  *current*; never the same buffer in one frame.
- **Async cascade races** (props change mid-init) → the component keeps its `cancelled` guard;
  the cascade disposes partially-initialized backends on failure.
- **~20% without WebGPU** → cascade to WebGL2, then Canvas2D.
- **Device loss** → inert + best-effort; documented.

## Open questions for the plan

- Workgroup size — default 64; revisit if profiling suggests otherwise.
- Render reads state as an instanced **vertex buffer** (chosen, mirrors WebGL2) vs a read-only
  storage binding indexed by `instance_index` — vertex buffer keeps the draw path parallel to
  P1.
- `alphaMode` for the canvas context (`premultiplied` vs `opaque`) — pick by eye for parity
  with the page composite; default `premultiplied` with a premultiplied-correct blend.
