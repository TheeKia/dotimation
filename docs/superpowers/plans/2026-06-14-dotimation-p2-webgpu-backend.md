# Dotimation P2 — WebGPU Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WebGPU `Backend` that runs the particle simulation in a WGSL compute shader over storage buffers and renders instanced quads, completing the WebGPU → WebGL2 → Canvas2D cascade — targeting 1M+ particles at 60fps with visual parity.

**Architecture:** Mirrors the P1 WebGL2 backend with WebGPU APIs (compute pass instead of transform feedback; storage buffers; async device). Reuses the shared pure `planReconcile`/`FieldDelta`, `viewport`, and `constants`. A new pure `resolveBackendOrder` + an async cascade in `select.ts` centralizes construct-and-init so a failed tier falls through to the next. Pure helpers are unit-tested; WGSL/pipeline code is playground-verified (no headless WebGPU here).

**Tech Stack:** TypeScript (strict, `isolatedDeclarations`), React 19, WebGPU (WGSL compute + render), `@webgpu/types`, Bun, Biome.

---

## Conventions for every task

- `isolatedDeclarations` → explicit return types on exports. `noUncheckedIndexedAccess` → `!` where valid. Biome: single quotes, no semicolons, 2-space indent; `bun run lint:fix` before commit.
- The full `bun run type-check`, `bun run lint`, `bun test` currently PASS and must stay green. Commit normally (NO `--no-verify`).
- **You cannot run a browser / WebGPU here.** Pure helpers get `bun test`; WGSL + pipeline code is verified later by a human in the playground. For GPU tasks, the gate is: file matches spec, type-check passes, lint passes, tests still green. Do NOT run `bun run dev`.
- State buffer layout (per particle, f32): `x@0, y@1, vx@2, vy@3, r@4, g@5, b@6, alpha@7` (8 floats, 32 bytes). Targets (f32): `homeX@0, homeY@1, homeR@2, homeG@3, homeB@4, targetAlpha@5` (6 floats, 24 bytes). These come from `STATE_FLOATS`/`TARGET_FLOATS` in `@/engine/reconcile-plan`.

---

## Task 1: Tooling + pure backend-order cascade

**Files:**
- Modify: `package.json` (add `@webgpu/types` devDependency), `tsconfig.json` (add to `types`)
- Create: `src/engine/cascade.ts`
- Test: `test/engine/cascade.test.ts`

- [ ] **Step 1: Add WebGPU types**

Run: `bun add -d @webgpu/types`
Then in `tsconfig.json`, add `"types": ["@webgpu/types"]` to `compilerOptions` (if a `types` array already exists, append `"@webgpu/types"`). Run `bun run type-check` → still PASS (nothing uses the types yet).

- [ ] **Step 2: Write the failing test**

Create `test/engine/cascade.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { resolveBackendOrder } from '@/engine/cascade'

describe('resolveBackendOrder', () => {
  test('auto returns supported tiers high-to-low, canvas2d always last', () => {
    expect(resolveBackendOrder('auto', { webgpu: true, webgl2: true })).toEqual([
      'webgpu', 'webgl2', 'canvas2d',
    ])
    expect(resolveBackendOrder('auto', { webgpu: false, webgl2: true })).toEqual([
      'webgl2', 'canvas2d',
    ])
    expect(resolveBackendOrder('auto', { webgpu: false, webgl2: false })).toEqual([
      'canvas2d',
    ])
  })

  test('explicit GPU choice falls back only to canvas2d safety net', () => {
    expect(resolveBackendOrder('webgpu', { webgpu: true, webgl2: true })).toEqual([
      'webgpu', 'canvas2d',
    ])
    expect(resolveBackendOrder('webgl2', { webgpu: true, webgl2: true })).toEqual([
      'webgl2', 'canvas2d',
    ])
  })

  test('explicit canvas2d is the only tier', () => {
    expect(resolveBackendOrder('canvas2d', { webgpu: true, webgl2: true })).toEqual([
      'canvas2d',
    ])
  })
})
```

Run: `bun test test/engine/cascade.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/engine/cascade.ts`:

```ts
import type { BackendKind } from '@/types'
import type { Capabilities } from './backend'

export type ConcreteBackend = Exclude<BackendKind, 'auto'>

/**
 * Ordered tier list to try, from best to the always-present Canvas2D safety net.
 * `'auto'` yields the supported subset; an explicit GPU choice yields that tier
 * then Canvas2D; `'canvas2d'` yields just Canvas2D.
 */
export function resolveBackendOrder(
  requested: BackendKind,
  caps: Capabilities,
): ConcreteBackend[] {
  if (requested === 'canvas2d') return ['canvas2d']
  if (requested === 'webgpu') return ['webgpu', 'canvas2d']
  if (requested === 'webgl2') return ['webgl2', 'canvas2d']
  const order: ConcreteBackend[] = []
  if (caps.webgpu) order.push('webgpu')
  if (caps.webgl2) order.push('webgl2')
  order.push('canvas2d')
  return order
}
```

Run: `bun test test/engine/cascade.test.ts` → PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
bun run lint:fix && git add package.json bun.lock tsconfig.json src/engine/cascade.ts test/engine/cascade.test.ts
git commit -m "feat: @webgpu/types + pure resolveBackendOrder cascade helper"
```

---

## Task 2: WGSL shaders

**Files:**
- Create: `src/backends/webgpu/shaders/sim.wgsl.ts`
- Create: `src/backends/webgpu/shaders/draw.wgsl.ts`

Shaders as exported strings. No unit test; verified when pipelines build + in the playground. `Params.count` is stored as f32 (cast to u32 in-shader) so the host uploads one `Float32Array`.

- [ ] **Step 1: Compute shader**

Create `src/backends/webgpu/shaders/sim.wgsl.ts`:

```ts
export const SIM_WGSL = `
struct Params {
  dt: f32, k: f32, c: f32, colorRate: f32,
  opacityRate: f32, jitter: f32, seed: f32, count: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> stateIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> stateOut: array<f32>;
@group(0) @binding(3) var<storage, read> targets: array<f32>;

fn hash(n: f32) -> f32 { return fract(sin(n) * 43758.5453123); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(P.count)) { return; }
  let s = i * 8u;
  let t = i * 6u;

  let x = stateIn[s + 0u]; let y = stateIn[s + 1u];
  let vx = stateIn[s + 2u]; let vy = stateIn[s + 3u];
  let r = stateIn[s + 4u]; let g = stateIn[s + 5u]; let b = stateIn[s + 6u];
  let alpha = stateIn[s + 7u];

  let hx = targets[t + 0u]; let hy = targets[t + 1u];
  let hr = targets[t + 2u]; let hg = targets[t + 3u]; let hb = targets[t + 4u];
  let ta = targets[t + 5u];

  let ax = P.k * (hx - x) - P.c * vx;
  let ay = P.k * (hy - y) - P.c * vy;
  let nvx = vx + ax * P.dt;
  let nvy = vy + ay * P.dt;
  var nx = x + nvx * P.dt;
  let ny = y + nvy * P.dt;
  nx = nx + (hash(f32(i) + P.seed) - 0.5) * P.jitter;

  let kc = 1.0 - exp(-P.colorRate * P.dt);
  let nr = r + (hr - r) * kc;
  let ng = g + (hg - g) * kc;
  let nb = b + (hb - b) * kc;

  let d = P.opacityRate * P.dt;
  var na = alpha;
  if (ta > 0.5) { na = min(1.0, alpha + d); } else { na = max(0.0, alpha - d); }

  stateOut[s + 0u] = nx; stateOut[s + 1u] = ny;
  stateOut[s + 2u] = nvx; stateOut[s + 3u] = nvy;
  stateOut[s + 4u] = nr; stateOut[s + 5u] = ng; stateOut[s + 6u] = nb;
  stateOut[s + 7u] = na;
}
`
```

- [ ] **Step 2: Render shader**

Create `src/backends/webgpu/shaders/draw.wgsl.ts`:

```ts
export const DRAW_WGSL = `
struct RParams { devW: f32, devH: f32, dpr: f32, dotSize: f32 };
@group(0) @binding(0) var<uniform> R: RParams;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
};

@vertex
fn vs(
  @location(0) corner: vec2<f32>,
  @location(1) instPos: vec2<f32>,
  @location(2) instColor: vec3<f32>,
  @location(3) instAlpha: f32,
) -> VOut {
  let dev = instPos * R.dpr + (corner - vec2<f32>(0.5, 0.5)) * R.dotSize + vec2<f32>(R.dotSize * 0.5, R.dotSize * 0.5);
  let clip = vec2<f32>(dev.x / R.devW * 2.0 - 1.0, 1.0 - dev.y / R.devH * 2.0);
  var o: VOut;
  o.pos = vec4<f32>(clip, 0.0, 1.0);
  o.color = instColor / 255.0;
  o.alpha = instAlpha;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  if (in.alpha <= 0.0) { discard; }
  return vec4<f32>(in.color, in.alpha);
}
`
```

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && git add src/backends/webgpu/shaders
git commit -m "feat: WebGPU sim (compute) + draw WGSL shaders"
```

---

## Task 3: Device + buffers

**Files:**
- Create: `src/backends/webgpu/device.ts`
- Create: `src/backends/webgpu/buffers.ts`

DOM/GPU-bound; verified in the playground.

- [ ] **Step 1: Device + context**

Create `src/backends/webgpu/device.ts`:

```ts
export interface GPUSetup {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

/** Acquires a device and configures the canvas. Throws if WebGPU is unavailable. */
export async function acquireGPU(canvas: HTMLCanvasElement): Promise<GPUSetup> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('webgpu: navigator.gpu unavailable')
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('webgpu: no adapter')
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('webgpu: no webgpu context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'premultiplied' })
  return { device, context, format }
}
```

- [ ] **Step 2: Buffers**

Create `src/backends/webgpu/buffers.ts`:

```ts
import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
import type { ParticleField } from '@/types'

// Unit quad as a triangle strip (4 corners in [0,1]).
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

export interface GPUBuffers {
  capacity: number
  quad: GPUBuffer
  state: [GPUBuffer, GPUBuffer]
  targets: GPUBuffer
  read: 0 | 1
}

const STATE_USAGE =
  GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
const TARGET_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

function makeBuffer(device: GPUDevice, bytes: number, usage: number): GPUBuffer {
  return device.createBuffer({ size: bytes, usage })
}

export function createBuffers(device: GPUDevice, capacity: number): GPUBuffers {
  const quad = device.createBuffer({
    size: QUAD.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(quad, 0, QUAD)
  const stateBytes = capacity * STATE_FLOATS * 4
  const targetBytes = capacity * TARGET_FLOATS * 4
  return {
    capacity,
    quad,
    state: [makeBuffer(device, stateBytes, STATE_USAGE), makeBuffer(device, stateBytes, STATE_USAGE)],
    targets: makeBuffer(device, targetBytes, TARGET_USAGE),
    read: 0,
  }
}

/** Interleaved state [x,y,vx,vy,r,g,b,alpha] for slots [start,end). */
export function packState(field: ParticleField, start: number, end: number): Float32Array {
  const out = new Float32Array((end - start) * STATE_FLOATS)
  let o = 0
  for (let i = start; i < end; i++) {
    out[o++] = field.x[i]!
    out[o++] = field.y[i]!
    out[o++] = field.vx[i]!
    out[o++] = field.vy[i]!
    out[o++] = field.r[i]!
    out[o++] = field.g[i]!
    out[o++] = field.b[i]!
    out[o++] = field.alpha[i]!
  }
  return out
}

/** Interleaved targets for slots [0,count). */
export function packTargets(field: ParticleField, count: number): Float32Array {
  const out = new Float32Array(count * TARGET_FLOATS)
  let o = 0
  for (let i = 0; i < count; i++) {
    out[o++] = field.homeX[i]!
    out[o++] = field.homeY[i]!
    out[o++] = field.homeR[i]!
    out[o++] = field.homeG[i]!
    out[o++] = field.homeB[i]!
    out[o++] = field.targetAlpha[i]!
  }
  return out
}

export function disposeBuffers(b: GPUBuffers): void {
  b.quad.destroy()
  b.state[0].destroy()
  b.state[1].destroy()
  b.targets.destroy()
}
```

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && git add src/backends/webgpu/device.ts src/backends/webgpu/buffers.ts
git commit -m "feat: WebGPU device acquisition + storage buffers"
```

---

## Task 4: Pipelines + bind groups

**Files:**
- Create: `src/backends/webgpu/pipelines.ts`

Builds the compute and render pipelines and the per-step bind groups. DOM/GPU-bound.

- [ ] **Step 1: Implement**

Create `src/backends/webgpu/pipelines.ts`:

```ts
import { STATE_FLOATS } from '@/engine/reconcile-plan'
import { DRAW_WGSL } from './shaders/draw.wgsl'
import { SIM_WGSL } from './shaders/sim.wgsl'

const STATE_STRIDE = STATE_FLOATS * 4

export interface Pipelines {
  compute: GPUComputePipeline
  render: GPURenderPipeline
  simUniform: GPUBuffer
  renderUniform: GPUBuffer
  /** Bind group reading `inState`, writing `outState`, with `targets` + sim uniforms. */
  simBindGroup(inState: GPUBuffer, outState: GPUBuffer, targets: GPUBuffer): GPUBindGroup
  renderBindGroup(): GPUBindGroup
  device: GPUDevice
}

export function createPipelines(device: GPUDevice, format: GPUTextureFormat): Pipelines {
  const simModule = device.createShaderModule({ code: SIM_WGSL })
  const drawModule = device.createShaderModule({ code: DRAW_WGSL })

  const compute = device.createComputePipeline({
    layout: 'auto',
    compute: { module: simModule, entryPoint: 'main' },
  })

  const render = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: drawModule,
      entryPoint: 'vs',
      buffers: [
        { arrayStride: 2 * 4, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        {
          arrayStride: STATE_STRIDE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' },
            { shaderLocation: 2, offset: 4 * 4, format: 'float32x3' },
            { shaderLocation: 3, offset: 7 * 4, format: 'float32' },
          ],
        },
      ],
    },
    fragment: {
      module: drawModule,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-strip' },
  })

  const simUniform = device.createBuffer({ size: 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const renderUniform = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

  return {
    compute,
    render,
    simUniform,
    renderUniform,
    device,
    simBindGroup(inState, outState, targets): GPUBindGroup {
      return device.createBindGroup({
        layout: compute.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: simUniform } },
          { binding: 1, resource: { buffer: inState } },
          { binding: 2, resource: { buffer: outState } },
          { binding: 3, resource: { buffer: targets } },
        ],
      })
    },
    renderBindGroup(): GPUBindGroup {
      return device.createBindGroup({
        layout: render.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: renderUniform } }],
      })
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/backends/webgpu/pipelines.ts
git commit -m "feat: WebGPU compute + render pipelines and bind groups"
```

---

## Task 5: WebGPU backend wiring (linchpin)

**Files:**
- Create: `src/backends/webgpu/index.ts`

The `Backend`: async init, compute step, instanced draw, readback-free reconcile delta (same as WebGL2 with WebGPU buffer ops), capacity growth, fader expiry, device-loss guard. Verified in the playground.

- [ ] **Step 1: Implement**

Create `src/backends/webgpu/index.ts`:

```ts
import { COLOR_RATE, JITTER_AMOUNT, OPACITY_RATE, SETTLE_TIME, ZETA } from '@/engine/constants'
import { planReconcile, STATE_FLOATS } from '@/engine/reconcile-plan'
import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import { createBuffers, disposeBuffers, type GPUBuffers, packState, packTargets } from './buffers'
import { acquireGPU } from './device'
import { createPipelines, type Pipelines } from './pipelines'

export interface WebGPUOptions {
  dotSize: number
}

const STATE_STRIDE_BYTES = STATE_FLOATS * 4

export function createWebGPUBackend(opts: WebGPUOptions): Backend {
  let device: GPUDevice | null = null
  let context: GPUCanvasContext | null = null
  let pipelines: Pipelines | null = null
  let buffers: GPUBuffers | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let count = 0
  let active = 0
  let lost = false
  let lastUpload = 0
  const { k, c } = tuneSpring({ settleTime: SETTLE_TIME, zeta: ZETA })
  const FADE_DURATION_MS = (1 / OPACITY_RATE + 0.15) * 1000

  function ensureCapacity(cap: number): void {
    if (!device || !buffers || buffers.capacity >= cap) return
    const old = buffers
    const next = createBuffers(device, cap)
    if (count > 0) {
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(old.state[old.read], 0, next.state[0], 0, count * STATE_STRIDE_BYTES)
      device.queue.submit([enc.finish()])
    }
    next.read = 0
    disposeBuffers(old)
    buffers = next
  }

  return {
    async init(canvas, devicePixelRatio): Promise<void> {
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      const setup = await acquireGPU(canvas)
      device = setup.device
      context = setup.context
      pipelines = createPipelines(device, setup.format)
      buffers = createBuffers(device, 1024)
      device.lost.then(() => {
        lost = true
      })
    },
    uploadField(field: ParticleField): void {
      if (!device || !buffers) return
      const plan = planReconcile(active, count, field.active)
      ensureCapacity(field.capacity)
      const b = buffers
      const current = b.state[b.read]!
      const other = b.state[b.read ^ 1]!

      device.queue.writeBuffer(b.targets, 0, packTargets(field, field.count))

      if (plan.firstLoad) {
        device.queue.writeBuffer(current, 0, packState(field, 0, field.count))
      } else if (plan.relocate) {
        const enc = device.createCommandEncoder()
        enc.copyBufferToBuffer(current, 0, other, 0, plan.overlap * STATE_STRIDE_BYTES)
        enc.copyBufferToBuffer(
          current, plan.relocate.from * STATE_STRIDE_BYTES,
          other, plan.relocate.to * STATE_STRIDE_BYTES,
          plan.relocate.len * STATE_STRIDE_BYTES,
        )
        device.queue.submit([enc.finish()])
        if (plan.spawn) {
          device.queue.writeBuffer(
            other, plan.spawn.start * STATE_STRIDE_BYTES,
            packState(field, plan.spawn.start, plan.spawn.end),
          )
        }
        b.read = (b.read ^ 1) as 0 | 1
      } else if (plan.spawn) {
        device.queue.writeBuffer(
          current, plan.spawn.start * STATE_STRIDE_BYTES,
          packState(field, plan.spawn.start, plan.spawn.end),
        )
      }

      active = plan.active
      count = plan.count
      lastUpload = performance.now()
    },
    step(dt: number): void {
      if (!device || !buffers || !pipelines || lost || count <= 0) return
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      const b = buffers
      // sim uniforms: dt,k,c,colorRate,opacityRate,jitter,seed,count
      const u = new Float32Array([dt, k, c, COLOR_RATE, OPACITY_RATE, JITTER_AMOUNT, Math.random() * 1000, count])
      device.queue.writeBuffer(pipelines.simUniform, 0, u)
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(pipelines.compute)
      pass.setBindGroup(0, pipelines.simBindGroup(b.state[b.read]!, b.state[b.read ^ 1]!, b.targets))
      pass.dispatchWorkgroups(Math.ceil(count / 64))
      pass.end()
      device.queue.submit([enc.finish()])
      b.read = (b.read ^ 1) as 0 | 1
    },
    draw(): void {
      if (!device || !context || !buffers || !pipelines || lost) return
      const b = buffers
      device.queue.writeBuffer(pipelines.renderUniform, 0, new Float32Array([devW, devH, dpr, opts.dotSize]))
      const enc = device.createCommandEncoder()
      const view = context.getCurrentTexture().createView()
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        ],
      })
      if (count > 0) {
        pass.setPipeline(pipelines.render)
        pass.setBindGroup(0, pipelines.renderBindGroup())
        pass.setVertexBuffer(0, b.quad)
        pass.setVertexBuffer(1, b.state[b.read]!)
        pass.draw(4, count)
      }
      pass.end()
      device.queue.submit([enc.finish()])
    },
    resize(w: number, h: number): void {
      devW = w
      devH = h
    },
    dispose(): void {
      if (buffers) disposeBuffers(buffers)
      pipelines?.simUniform.destroy()
      pipelines?.renderUniform.destroy()
      device = null
      context = null
      pipelines = null
      buffers = null
    },
  }
}
```

> Notes: `init` is `async` (the `Backend` interface allows `Promise<void> | void`). The reconcile delta mirrors WebGL2 exactly with WebGPU buffer ops (`writeBuffer` for uploads/spawn, `copyBufferToBuffer` for overlap/relocate/growth). `count` is uploaded each step so the compute shader bounds itself. The render pass always runs (to clear); it only draws when `count > 0`.

- [ ] **Step 2: Gate**

`bun run type-check`, `bun run lint`, `bun test` (31 + the 3 cascade tests = 34) all pass. Resolve `noUncheckedIndexedAccess` with `!` on `b.state[...]` reads as elsewhere. Do NOT change buffer offsets or delta logic.

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && git add src/backends/webgpu/index.ts
git commit -m "feat: WebGPU backend (compute sim + instanced draw + reconcile sync)"
```

---

## Task 6: Wire WebGPU into selection + component + playground + docs

**Files:**
- Modify: `src/engine/select.ts` (async cascade), `src/components/dotimation.tsx`, `test/ui/src/app.tsx`, `CLAUDE.md`

- [ ] **Step 1: Refactor `select.ts` to an async construct-and-init cascade**

Replace `src/engine/select.ts` with:

```ts
import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities } from './backend'
import { type ConcreteBackend, resolveBackendOrder } from './cascade'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
  canvas: HTMLCanvasElement
  dpr: number
}

async function construct(kind: ConcreteBackend, dotSize: number): Promise<Backend> {
  if (kind === 'webgpu') {
    return (await import('@/backends/webgpu')).createWebGPUBackend({ dotSize })
  }
  if (kind === 'webgl2') {
    return (await import('@/backends/webgl2')).createWebGL2Backend({ dotSize })
  }
  return createCanvas2DBackend({ dotSize })
}

/**
 * Constructs and initializes the best available backend, trying tiers in order
 * (GPU backends are dynamically imported / code-split) and falling through to
 * the next on any construct/init failure. Canvas2D is the always-present last
 * tier and is assumed not to throw.
 */
export async function selectBackend(opts: SelectOptions): Promise<Backend> {
  const order = resolveBackendOrder(opts.requested, detectCapabilities())
  for (const kind of order) {
    try {
      const be = await construct(kind, opts.dotSize)
      await be.init(opts.canvas, opts.dpr)
      return be
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.info(`[dotimation] ${kind} backend unavailable, trying next`, err)
      }
    }
  }
  const be = createCanvas2DBackend({ dotSize: opts.dotSize })
  await be.init(opts.canvas, opts.dpr)
  return be
}
```

- [ ] **Step 2: Simplify the component effect**

In `src/components/dotimation.tsx`, the engine-creation effect no longer needs its own init/try-catch fallback (the cascade owns that). Replace the async IIFE body:

```tsx
    const dpr = sizeCanvas(canvas, width, height)

    void (async () => {
      const be = await selectBackend({ requested: backend, dotSize, canvas, dpr })
      if (cancelled) {
        be.dispose()
        return
      }
      engine = createEngine({ backend: be, canvas, dpr, idle })
      engineRef.current = engine
      fieldRef.current = createField(1024)
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        engine.setField(fieldRef.current)
      }
    })()
```

Remove the now-unused `createCanvas2DBackend` import from the component (the cascade handles fallback). Keep `sizeCanvas`, `selectBackend`, `createEngine`, `createField`, `reconcile`, etc. Keep the rest of the component unchanged.

- [ ] **Step 3: Capability detection already covers WebGPU**

Confirm `detectCapabilities` in `src/engine/backend.ts` reports `webgpu: 'gpu' in navigator` (it does from P0). No change needed; `resolveBackendOrder` does the rest.

- [ ] **Step 4: Playground — add `webgpu` button**

In `test/ui/src/app.tsx`, add `'webgpu'` to the backend button list: `(['auto', 'canvas2d', 'webgl2', 'webgpu'] as BackendKind[])`. Keep everything else.

- [ ] **Step 5: Full gate**

Run `bun run type-check && bun run lint && bun test && bun run build`. All green. Build should emit a third dynamic chunk for the WebGPU backend (code-split). 34 tests pass.

- [ ] **Step 6: Docs**

In `CLAUDE.md`, update the Backends bullet: three backends now ship — `canvas2d`, `webgl2`, and `webgpu` (WGSL compute-shader physics + instanced render, `src/backends/webgpu/`). `select.ts` is an async **cascade** (`resolveBackendOrder` in `src/engine/cascade.ts`) that construct-and-inits tiers in order (`webgpu → webgl2 → canvas2d`), each GPU tier dynamically imported (code-split). Note `@webgpu/types` is a devDependency. WebGPU compute reaches 1M+ particles.

- [ ] **Step 7: Commit**

```bash
bun run lint:fix && git add src/engine/select.ts src/components/dotimation.tsx test/ui/src/app.tsx CLAUDE.md
git commit -m "feat: wire WebGPU into async backend cascade; playground + docs"
```

- [ ] **Step 8: Playground verification (human)**

`bun run dev`: on a WebGPU-capable browser, `auto` selects WebGPU; the `webgpu` button renders dots with parity to `webgl2`/`canvas2d`; morphs are smooth; the stress preset sustains 60fps and the high-count path far exceeds the other tiers. Force-disable WebGPU (or use a non-WebGPU browser) → cascade falls to `webgl2`. Toggle backends rapidly → no blank/crash.

---

## Definition of done (P2)

- `bun run type-check && bun run lint && bun test && bun run build` all green (34 tests: + 3 cascade).
- Playground: `webgpu` renders with parity; cascade `webgpu → webgl2 → canvas2d` works; stress preset hits the high-count target on WebGPU.
- WebGPU backend is code-split (own dynamic chunk); `@webgpu/types` added.
- Device loss does not crash.

## Self-review notes (done while writing)

- **Spec coverage:** WGSL compute physics (T2/T5), instanced render (T2/T4/T5), storage-buffer ping-pong (T3), readback-free reconcile sync reusing `planReconcile` (T5), async device + loss guard (T3/T5), full cascade via pure `resolveBackendOrder` + async `select.ts` (T1/T6), capability detection (T6), playground + docs (T6). P3 items deferred.
- **Type consistency:** `STATE_FLOATS`/`TARGET_FLOATS` reused; state stride 32B with pos@0/color@16/alpha@28 consistent across `packState`, the render vertex attributes (T4), and the compute indexing (T2); `resolveBackendOrder(requested, caps)`, `selectBackend({requested,dotSize,canvas,dpr})`, `createWebGPUBackend({dotSize})`, `createPipelines(device, format)` signatures match across tasks.
- **Risk note:** the WGSL + pipeline/bind-group wiring (T2/T4/T5) is the highest-risk, playground-tuned part; the pure cascade + reconcile delta are unit-tested, and a final read-through review precedes the human browser test. Uniform structs are 16-byte-aligned (sim 32B, render 16B); `count` is an f32 to keep one Float32Array upload.
