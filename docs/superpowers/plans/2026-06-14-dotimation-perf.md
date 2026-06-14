# Dotimation Performance Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land six self-contained performance improvements across the dotimation particle pipeline without changing the visual look of the animation.

**Architecture:** Pure cores (`render`, `sample`, `pack`, `rest`) are extended/added with TDD under `bun test`; DOM/GPU shells (Canvas2D backend, WebGL2/WebGPU backends, engine) are wired to them and verified in the `test/ui` playground. Each task is independently shippable and committed separately.

**Tech Stack:** TypeScript, Bun (test + build), React 19, Canvas2D / WebGL2 (transform feedback) / WebGPU (compute), Biome.

**Decisions locked in (from brainstorming):**
- **Keep the beautiful animation.** No task may change the morph/shimmer look. Finding #4 is therefore reframed from "remove the shuffle" to "make the shuffle cheaper while keeping it equally random."
- **Defer the OffscreenCanvas worker (original finding #2)** to its own future plan. Not in scope here.

**Verification note:** Per `CLAUDE.md`, there is no headless GL/WebGPU. Tasks touching the WebGL2/WebGPU backends (Tasks 4 and 5) are verified by running `bun run dev` and watching the relevant tier in the playground, plus `bun run type-check` and `bun run lint`. All other tasks are fully unit-tested.

**Run after every task (gate before commit):**
```bash
bun test && bun run type-check && bun run lint
```

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/backends/canvas2d/render.ts` | Add `DirtyRect`, `computeDirtyRect`, `unionRect`; scope `renderField`'s clear; reciprocal blend | 1 |
| `src/backends/canvas2d/index.ts` | Track `prevDirty`; partial clear + dirty-rect `putImageData` | 1 |
| `src/raster/sample.ts` | Fast xorshift PRNG as the default shuffle RNG | 2 |
| `src/raster/rasterize.ts`, `src/raster/raster.worker.ts` | Use the sampler's default RNG | 2 |
| `src/backends/webgl2/buffers.ts`, `src/backends/webgpu/buffers.ts` | `packStateInto` / `packTargetsInto` writing into a reused scratch buffer | 3 |
| `src/backends/webgl2/index.ts`, `src/backends/webgpu/index.ts` | Hold + grow scratch buffers; call the `*Into` packers | 3 |
| `src/backends/webgl2/index.ts` | Hoist `viewport` / `clearColor` out of per-frame `draw` | 4 |
| `src/backends/webgpu/index.ts` | One command encoder + one `queue.submit` per frame | 5 |
| `src/engine/rest.ts` (new) | Pure `isFieldSettled` convergence predicate | 6 |
| `src/types.ts` | Add optional `settled?()` to `Backend` | 6 |
| `src/backends/canvas2d/index.ts` | Implement `settled()` | 6 |
| `src/engine/engine.ts` | Early-sleep when `backend.settled()` | 6 |

---

## Task 1: Canvas2D dirty-rectangle render (+ reciprocal blend)

Today `renderField` does `view.fill(0)` over the entire backing store and `draw()` does a full-buffer `putImageData` every frame — O(devW·devH) regardless of particle count. This task scopes both to the bounding box of the dots (union of last frame's and this frame's), and replaces three divisions per blended pixel with one reciprocal. No visual change: identical pixels are produced, fewer are touched.

**Files:**
- Modify: `src/backends/canvas2d/render.ts`
- Modify: `src/backends/canvas2d/index.ts`
- Test: `test/backends/canvas2d/render.test.ts`

- [ ] **Step 1: Write failing tests for `computeDirtyRect` and `unionRect`**

Append to `test/backends/canvas2d/render.test.ts`:

```ts
import { computeDirtyRect, unionRect } from '@/backends/canvas2d/render'

describe('computeDirtyRect', () => {
  test('tight box around a single dot at dotSize 1', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 1)).toEqual({ x: 2, y: 3, w: 1, h: 1 })
  })

  test('expands by the footprint for dotSize 2', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 2)).toEqual({ x: 2, y: 3, w: 2, h: 2 })
  })

  test('null when nothing is visible', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.alpha[0] = 0
    expect(computeDirtyRect(f, 8, 8, 1, 1)).toBeNull()
  })

  test('clamps to the canvas bounds', () => {
    const f = reconcile(createField(1), one(7, 7))
    f.x[0] = 7
    f.y[0] = 7
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 4)).toEqual({ x: 7, y: 7, w: 1, h: 1 })
  })
})

describe('unionRect', () => {
  test('covers both rects', () => {
    expect(unionRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 3, y: 3, w: 1, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 4,
    })
  })
  test('returns the non-null side', () => {
    expect(unionRect(null, { x: 2, y: 2, w: 1, h: 1 })).toEqual({ x: 2, y: 2, w: 1, h: 1 })
    expect(unionRect({ x: 2, y: 2, w: 1, h: 1 }, null)).toEqual({ x: 2, y: 2, w: 1, h: 1 })
    expect(unionRect(null, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the new tests; verify they fail**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: FAIL — `computeDirtyRect`/`unionRect` are not exported.

- [ ] **Step 3: Add `DirtyRect`, `computeDirtyRect`, `unionRect` to `render.ts`**

Add to `src/backends/canvas2d/render.ts` (after the imports / before `clamp255`):

```ts
export interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Device-pixel bounding box of every visible (alpha>0) dot, expanded by the
 * footprint and clamped to the canvas. Null when nothing is visible. The box is
 * a superset of every pixel renderField writes this frame, so the backend can
 * clear and upload just this region instead of the whole buffer.
 */
export function computeDirtyRect(
  field: ParticleField,
  devW: number,
  devH: number,
  dpr: number,
  dotSize: number,
): DirtyRect | null {
  const size = Math.max(1, Math.round(dotSize))
  const { x, y, alpha } = field
  const count = field.count
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i++) {
    if (alpha[i]! <= 0) continue
    const bx = (x[i]! * dpr + 0.5) | 0
    const by = (y[i]! * dpr + 0.5) | 0
    if (bx < minX) minX = bx
    if (by < minY) minY = by
    if (bx > maxX) maxX = bx
    if (by > maxY) maxY = by
  }
  if (minX === Infinity) return null
  const x0 = minX < 0 ? 0 : minX
  const y0 = minY < 0 ? 0 : minY
  const x1 = Math.min(devW, maxX + size)
  const y1 = Math.min(devH, maxY + size)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Smallest rect covering both inputs; the non-null side if one is null; null if both are. */
export function unionRect(
  a: DirtyRect | null,
  b: DirtyRect | null,
): DirtyRect | null {
  if (!a) return b
  if (!b) return a
  const x0 = a.x < b.x ? a.x : b.x
  const y0 = a.y < b.y ? a.y : b.y
  const ax1 = a.x + a.w
  const bx1 = b.x + b.w
  const ay1 = a.y + a.h
  const by1 = b.y + b.h
  const x1 = ax1 > bx1 ? ax1 : bx1
  const y1 = ay1 > by1 ? ay1 : by1
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
```

- [ ] **Step 4: Run the tests; verify they pass**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: PASS (all, including the pre-existing `renderField` tests).

- [ ] **Step 5: Write a failing test for scoped clearing in `renderField`**

Append to `test/backends/canvas2d/render.test.ts`:

```ts
describe('renderField scoped clear', () => {
  test('with a clearRect, pixels outside the rect are left untouched', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8).fill(0xdeadbeef)
    renderField(view, f, 8, 8, 1, 1, { x: 1, y: 1, w: 3, h: 3 })
    // A pixel well outside the clearRect keeps its sentinel value.
    expect(view[0]).toBe(0xdeadbeef)
    expect(view[7 * 8 + 7]).toBe(0xdeadbeef)
    // The dot pixel inside the clearRect was written (not the sentinel, not 0).
    expect(view[2 * 8 + 2]).not.toBe(0xdeadbeef)
    expect(view[2 * 8 + 2]).not.toBe(0)
  })

  test('without a clearRect, the whole buffer is cleared (back-compat)', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8).fill(0xdeadbeef)
    renderField(view, f, 8, 8, 1, 1)
    expect(view[0]).toBe(0)
  })
})
```

- [ ] **Step 6: Run; verify the scoped-clear test fails**

Run: `bun test test/backends/canvas2d/render.test.ts -t "scoped clear"`
Expected: FAIL — `renderField` ignores the extra argument and clears the whole buffer, so `view[0]` is `0`, not the sentinel.

- [ ] **Step 7: Add the optional `clearRect` parameter to `renderField`**

In `src/backends/canvas2d/render.ts`, change the signature and the clear at the top of `renderField`:

```ts
export function renderField(
  view: Uint32Array,
  field: ParticleField,
  devW: number,
  devH: number,
  dpr: number,
  dotSize: number,
  clearRect?: DirtyRect | null,
): void {
  if (clearRect) {
    const { x: cx, y: cy, w: cw, h: ch } = clearRect
    const yEnd = cy + ch
    for (let row = cy; row < yEnd; row++) {
      const base = row * devW + cx
      view.fill(0, base, base + cw)
    }
  } else {
    view.fill(0)
  }
  const size = Math.max(1, Math.round(dotSize))
  // ...rest of the function is unchanged...
```

Leave the rest of `renderField` (the `size === 1` fast path and the footprint loop) exactly as-is.

- [ ] **Step 8: Replace the three divisions in `compositePixel` with one reciprocal**

In `src/backends/canvas2d/render.ts`, in `compositePixel`, replace:

```ts
  const outA = clampedA + da * (1 - clampedA)
  const outR = (sr * clampedA + dr * da * (1 - clampedA)) / outA
  const outG = (sg * clampedA + dg * da * (1 - clampedA)) / outA
  const outB = (sb * clampedA + db * da * (1 - clampedA)) / outA
```

with:

```ts
  const outA = clampedA + da * (1 - clampedA)
  const inv = 1 / outA
  const outR = (sr * clampedA + dr * da * (1 - clampedA)) * inv
  const outG = (sg * clampedA + dg * da * (1 - clampedA)) * inv
  const outB = (sb * clampedA + db * da * (1 - clampedA)) * inv
```

- [ ] **Step 9: Run the full render test file; verify it passes**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: PASS — scoped-clear, dirty-rect, and the original blend/composite tests all green.

- [ ] **Step 10: Wire the backend `draw()` to use the dirty rect**

In `src/backends/canvas2d/index.ts`:

Update the import:
```ts
import { computeDirtyRect, renderField, unionRect, type DirtyRect } from './render'
```

Add a tracking variable alongside the other backend state (near `let dotSize = opts.dotSize`):
```ts
  let prevDirty: DirtyRect | null = null
```

Replace the `draw()` method body:
```ts
    draw(): void {
      if (!ctx || !field) return
      ensureBuffer()
      if (!imageData || !view) return
      const cur = computeDirtyRect(field, devW, devH, dpr, dotSize)
      const clearR = unionRect(prevDirty, cur)
      prevDirty = cur
      if (!clearR) return
      renderField(view, field, devW, devH, dpr, dotSize, clearR)
      ctx.putImageData(imageData, 0, 0, clearR.x, clearR.y, clearR.w, clearR.h)
    },
```

In `resize()`, reset the tracker (the buffer is recreated zeroed, so last frame's region is gone). Change `resize` to:
```ts
    resize(w, h): void {
      devW = w
      devH = h
      imageData = null
      view = null
      prevDirty = null
      ensureBuffer()
    },
```

- [ ] **Step 11: Type-check, lint, and verify in the playground**

Run:
```bash
bun run type-check && bun run lint
```
Expected: clean.

Then run `bun run dev`, force the Canvas2D tier (`backend="canvas2d"`), and confirm: text/image renders identically, morphs smoothly on content change, and no stale dots are left behind when the layout shrinks or moves.

- [ ] **Step 12: Commit**

```bash
git add src/backends/canvas2d/render.ts src/backends/canvas2d/index.ts test/backends/canvas2d/render.test.ts
git commit -m "perf(canvas2d): dirty-rectangle clear + putImageData, reciprocal blend"
```

---

## Task 2: Faster sampler shuffle RNG

The uncapped (default) sampler path shuffles every sampled pixel with `Math.random`. Keep the shuffle (it drives the scattered morph) but feed it a fast xorshift PRNG — equally uniform, ~2-3× cheaper per call. `rand` stays injectable so tests remain deterministic.

**Files:**
- Modify: `src/raster/sample.ts`
- Modify: `src/raster/rasterize.ts`
- Modify: `src/raster/raster.worker.ts`
- Test: `test/raster/sample.test.ts`

- [ ] **Step 1: Write a failing test for the default-RNG path**

Append to `test/raster/sample.test.ts` (inside the existing `describe('sampleTargets maxParticles', ...)` block, after the `tagged()` helper and its test, or in a new describe — it references `opaque()` from that block, so place it inside it):

```ts
  test('default RNG keeps every candidate as a permutation', () => {
    // No `rand` argument → uses the sampler's built-in fast PRNG.
    const t = sampleTargets(opaque(), 4, 4, 1, 1, 128)
    expect(t.count).toBe(16)
    const seen = new Set<string>()
    for (let i = 0; i < t.count; i++) seen.add(`${t.homeX[i]},${t.homeY[i]}`)
    expect(seen.size).toBe(16) // all distinct → a true permutation, nothing dropped
  })
```

- [ ] **Step 2: Run; verify it passes already OR fails meaningfully**

Run: `bun test test/raster/sample.test.ts -t "permutation"`
Expected: PASS (the current default is `Math.random`, which also yields a permutation). This test guards behavior across the RNG swap — it should stay green after Step 3.

- [ ] **Step 3: Add the xorshift PRNG and make it the default**

In `src/raster/sample.ts`, add above `sampleTargets`:

```ts
// Cheap xorshift32 PRNG for the candidate shuffle — uniform enough for a random
// subset, and far cheaper than Math.random when sampling tens of thousands of
// pixels. `rand` stays injectable below so tests are deterministic.
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1
function fastRand(): number {
  rngState ^= rngState << 13
  rngState ^= rngState >>> 17
  rngState ^= rngState << 5
  rngState >>>= 0
  return rngState / 0xffffffff
}
```

Change the parameter default from:
```ts
  rand: () => number = Math.random,
```
to:
```ts
  rand: () => number = fastRand,
```

- [ ] **Step 4: Use the default at both call sites**

In `src/raster/rasterize.ts`, change the `sampleTargets` call's `rand` argument from `Math.random` to `undefined` so the fast default is used (positional `maxParticles` must stay last):

```ts
  return sampleTargets(
    img.data,
    devW,
    devH,
    dpr,
    pointSpacingCss,
    alpha,
    undefined,
    maxParticles,
  )
```

In `src/raster/raster.worker.ts`, change the `sampleTargets` call's `Math.random` argument to `undefined`:

```ts
  return sampleTargets(
    img.data,
    w,
    h,
    req.dpr,
    req.pointSpacingCss,
    req.alpha,
    undefined,
    req.maxParticles,
  )
```

- [ ] **Step 5: Run the sampler tests; verify they pass**

Run: `bun test test/raster/sample.test.ts`
Expected: PASS (deterministic tests still pass their explicit `rand`; the permutation test passes with `fastRand`).

- [ ] **Step 6: Type-check and lint**

Run: `bun run type-check && bun run lint`
Expected: clean. (`bun run build` regenerates the worker bundle; not required for tests, but the worker picks up the change at next build/dev.)

- [ ] **Step 7: Commit**

```bash
git add src/raster/sample.ts src/raster/rasterize.ts src/raster/raster.worker.ts test/raster/sample.test.ts
git commit -m "perf(raster): use fast xorshift PRNG for the candidate shuffle"
```

---

## Task 3: Reuse a scratch buffer in GPU field packing

`packState` / `packTargets` allocate a fresh `Float32Array` on every `uploadField` (each content/resize change) in both GPU backends. Convert them to write into a caller-owned scratch buffer that the backend grows alongside its GPU buffers, returning a right-sized subarray view. The pack functions stay pure (output is a parameter) and unit-testable. `gl.bufferSubData` and `queue.writeBuffer` both copy synchronously, so reusing the scratch across calls is safe.

**Files:**
- Modify: `src/backends/webgl2/buffers.ts`, `src/backends/webgl2/index.ts`
- Modify: `src/backends/webgpu/buffers.ts`, `src/backends/webgpu/index.ts`
- Test: `test/backends/webgl2/buffers.test.ts` (new)

- [ ] **Step 1: Write failing tests for `packStateInto` / `packTargetsInto`**

Create `test/backends/webgl2/buffers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { packStateInto, packTargetsInto } from '@/backends/webgl2/buffers'
import { createField } from '@/engine/field'

function seed() {
  const f = createField(2)
  f.x.set([1, 5], 0)
  f.y.set([2, 6], 0)
  f.vx.set([0, 0], 0)
  f.vy.set([0, 0], 0)
  f.r.set([10, 40], 0)
  f.g.set([20, 50], 0)
  f.b.set([30, 60], 0)
  f.alpha.set([1, 0.5], 0)
  f.homeX.set([1, 5], 0)
  f.homeY.set([2, 6], 0)
  f.homeR.set([10, 40], 0)
  f.homeG.set([20, 50], 0)
  f.homeB.set([30, 60], 0)
  f.targetAlpha.set([1, 0], 0)
  return f
}

describe('packStateInto', () => {
  test('writes interleaved [x,y,vx,vy,r,g,b,alpha] into the scratch and returns a right-sized view', () => {
    const f = seed()
    const scratch = new Float32Array(64)
    const out = packStateInto(scratch, f, 0, 2)
    expect(out.length).toBe(16) // 2 slots * 8 floats
    expect(Array.from(out)).toEqual([1, 2, 0, 0, 10, 20, 30, 1, 5, 6, 0, 0, 40, 50, 60, 0.5])
    expect(out.buffer).toBe(scratch.buffer) // a view, not a fresh allocation
  })

  test('packs a sub-range [start,end)', () => {
    const f = seed()
    const out = packStateInto(new Float32Array(64), f, 1, 2)
    expect(out.length).toBe(8)
    expect(Array.from(out)).toEqual([5, 6, 0, 0, 40, 50, 60, 0.5])
  })
})

describe('packTargetsInto', () => {
  test('writes interleaved [homeX,homeY,homeR,homeG,homeB,targetAlpha]', () => {
    const f = seed()
    const out = packTargetsInto(new Float32Array(64), f, 2)
    expect(out.length).toBe(12) // 2 slots * 6 floats
    expect(Array.from(out)).toEqual([1, 2, 10, 20, 30, 1, 5, 6, 40, 50, 60, 0])
  })
})
```

- [ ] **Step 2: Run; verify they fail**

Run: `bun test test/backends/webgl2/buffers.test.ts`
Expected: FAIL — `packStateInto` / `packTargetsInto` are not exported.

- [ ] **Step 3: Convert the WebGL2 packers to write-into-scratch**

In `src/backends/webgl2/buffers.ts`, replace `packState` and `packTargets` with:

```ts
/** Writes interleaved state [x,y,vx,vy,r,g,b,alpha] for slots [start,end) into `out`; returns the used view. */
export function packStateInto(
  out: Float32Array,
  field: ParticleField,
  start: number,
  end: number,
): Float32Array {
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
  return out.subarray(0, o)
}

/** Writes interleaved targets for slots [0,count) into `out`; returns the used view. */
export function packTargetsInto(
  out: Float32Array,
  field: ParticleField,
  count: number,
): Float32Array {
  let o = 0
  for (let i = 0; i < count; i++) {
    out[o++] = field.homeX[i]!
    out[o++] = field.homeY[i]!
    out[o++] = field.homeR[i]!
    out[o++] = field.homeG[i]!
    out[o++] = field.homeB[i]!
    out[o++] = field.targetAlpha[i]!
  }
  return out.subarray(0, o)
}
```

- [ ] **Step 4: Run; verify the buffers tests pass**

Run: `bun test test/backends/webgl2/buffers.test.ts`
Expected: PASS.

- [ ] **Step 5: Hold + grow scratch buffers in the WebGL2 backend**

In `src/backends/webgl2/index.ts`:

Update the buffers import to the new names:
```ts
import {
  createBuffers,
  disposeBuffers,
  type GLBuffers,
  packStateInto,
  packTargetsInto,
} from './buffers'
```

Add `TARGET_FLOATS` to the reconcile-plan import:
```ts
import { planReconcile, STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
```

Add scratch state near `let lastField: ParticleField | null = null`:
```ts
  let stateScratch = new Float32Array(1024 * STATE_FLOATS)
  let targetScratch = new Float32Array(1024 * TARGET_FLOATS)
```

At the end of `ensureCapacity` (after `buffers = next` / the VAO rebinds), grow the scratch to match:
```ts
    if (stateScratch.length < next.capacity * STATE_FLOATS) {
      stateScratch = new Float32Array(next.capacity * STATE_FLOATS)
    }
    if (targetScratch.length < next.capacity * TARGET_FLOATS) {
      targetScratch = new Float32Array(next.capacity * TARGET_FLOATS)
    }
```

In `uploadField`, replace each `packTargets(field, field.count)` with `packTargetsInto(targetScratch, field, field.count)` and each `packState(field, a, b)` with `packStateInto(stateScratch, field, a, b)`. Concretely:
- `gl.bufferSubData(gl.ARRAY_BUFFER, 0, packTargets(field, field.count))` → `gl.bufferSubData(gl.ARRAY_BUFFER, 0, packTargetsInto(targetScratch, field, field.count))`
- `packState(field, 0, field.count)` → `packStateInto(stateScratch, field, 0, field.count)`
- `packState(field, plan.spawn.start, plan.spawn.end)` (both occurrences) → `packStateInto(stateScratch, field, plan.spawn.start, plan.spawn.end)`

- [ ] **Step 6: Convert the WebGPU packers identically**

In `src/backends/webgpu/buffers.ts`, replace `packState`/`packTargets` with the exact same `packStateInto`/`packTargetsInto` bodies as Step 3.

- [ ] **Step 7: Hold + grow scratch in the WebGPU backend**

In `src/backends/webgpu/index.ts`:

Update the buffers import:
```ts
import {
  createBuffers,
  disposeBuffers,
  type GPUBuffers,
  packStateInto,
  packTargetsInto,
} from './buffers'
```

Add `TARGET_FLOATS`:
```ts
import { planReconcile, STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
```

Add scratch near `let dotSize = opts.dotSize`:
```ts
  let stateScratch = new Float32Array(1024 * STATE_FLOATS)
  let targetScratch = new Float32Array(1024 * TARGET_FLOATS)
```

At the end of `ensureCapacity` (after `rebuildBindGroups()`), grow scratch:
```ts
    if (stateScratch.length < next.capacity * STATE_FLOATS) {
      stateScratch = new Float32Array(next.capacity * STATE_FLOATS)
    }
    if (targetScratch.length < next.capacity * TARGET_FLOATS) {
      targetScratch = new Float32Array(next.capacity * TARGET_FLOATS)
    }
```

In `uploadField`, replace:
- `device.queue.writeBuffer(b.targets, 0, packTargets(field, field.count))` → `device.queue.writeBuffer(b.targets, 0, packTargetsInto(targetScratch, field, field.count))`
- `packState(field, 0, field.count)` → `packStateInto(stateScratch, field, 0, field.count)`
- `packState(field, plan.spawn.start, plan.spawn.end)` (both occurrences) → `packStateInto(stateScratch, field, plan.spawn.start, plan.spawn.end)`

- [ ] **Step 8: Type-check, lint, test**

Run: `bun test && bun run type-check && bun run lint`
Expected: clean.

- [ ] **Step 9: Playground sanity check**

Run `bun run dev`. With `backend="webgl2"` and then `backend="webgpu"`, change the content several times (and resize) — confirm dots still morph correctly and capacity growth (large image) works without artifacts.

- [ ] **Step 10: Commit**

```bash
git add src/backends/webgl2/buffers.ts src/backends/webgl2/index.ts src/backends/webgpu/buffers.ts src/backends/webgpu/index.ts test/backends/webgl2/buffers.test.ts
git commit -m "perf(gpu): pack field state into a reused scratch buffer"
```

---

## Task 4: Hoist WebGL2 per-frame viewport/clearColor

`draw()` re-sets `gl.viewport` and `gl.clearColor` every frame. The viewport is already set on `init`/`resize`, and the clear color never changes. Set the clear color once at resource build and drop the redundant per-frame calls; keep the per-frame `gl.clear`.

**Files:**
- Modify: `src/backends/webgl2/index.ts`

- [ ] **Step 1: Set the clear color once in `buildResources`**

In `src/backends/webgl2/index.ts`, in `buildResources`, after `gl.enable(gl.BLEND)` / the `blendFuncSeparate` call and before/after `gl.viewport(0, 0, devW, devH)`, add:
```ts
    gl.clearColor(0, 0, 0, 0)
```

- [ ] **Step 2: Drop the redundant per-frame calls in `draw`**

In `draw()`, remove these two lines:
```ts
      gl.viewport(0, 0, devW, devH)
      gl.clearColor(0, 0, 0, 0)
```
Keep `gl.clear(gl.COLOR_BUFFER_BIT)`. The method becomes:
```ts
    draw(): void {
      if (!gl || !buffers || !draw || lost) return
      gl.clear(gl.COLOR_BUFFER_BIT)
      const b = buffers
      draw.use(b.read, count, { devW, devH, dpr, dotSize })
    },
```

- [ ] **Step 3: Type-check and lint**

Run: `bun run type-check && bun run lint`
Expected: clean. (`devW`/`devH`/`dpr`/`dotSize` are still referenced via `draw.use`, so no unused-variable errors.)

- [ ] **Step 4: Playground verify**

Run `bun run dev` with `backend="webgl2"`. Resize the window and change content — confirm the dots still fill the canvas correctly (viewport stays correct after resize) and the background stays transparent.

- [ ] **Step 5: Commit**

```bash
git add src/backends/webgl2/index.ts
git commit -m "perf(webgl2): hoist viewport/clearColor out of the per-frame draw"
```

---

## Task 5: One command encoder + one submit per frame (WebGPU)

Today each physics step does a `writeBuffer` + its own encoder + `submit`, and `draw` is a third encoder + `submit` — up to three submits per frame. Accumulate the frame's step count, then in `draw` record one compute pass per step (separate passes give the required write→read barrier for ping-pong) followed by the render pass, into a single encoder submitted once. The per-step jitter seed becomes constant within a frame (cosmetic only; steps-per-frame is almost always 1).

**Files:**
- Modify: `src/backends/webgpu/index.ts`

- [ ] **Step 1: Add per-frame accumulation state**

In `src/backends/webgpu/index.ts`, add near `let renderUniformDirty = true`:
```ts
  // Steps are accumulated by step() and flushed in draw() so the whole frame
  // (all compute passes + the render pass) is one encoder / one submit.
  let pendingSteps = 0
  let stepDt = FIXED_DT
```

Add the `FIXED_DT` import at the top (it lives in the clock):
```ts
import { FIXED_DT } from '@/engine/clock'
```

- [ ] **Step 2: Make `step` record intent only (no GPU work)**

Replace the `step` method with:
```ts
    step(dt: number): void {
      if (!device || !buffers || !pipelines || !simBindGroups || lost) return
      if (count <= 0) return
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      stepDt = dt
      pendingSteps++
    },
```

- [ ] **Step 3: Flush everything in `draw` as a single encoder + submit**

Replace the `draw` method with:
```ts
    draw(): void {
      if (!device || !context || !buffers || !pipelines || !renderBind || lost) {
        pendingSteps = 0
        return
      }
      const b = buffers
      const steps = pendingSteps
      pendingSteps = 0

      if (steps > 0 && count > 0 && simBindGroups) {
        simU[0] = stepDt
        simU[1] = k
        simU[2] = c
        simU[3] = COLOR_RATE
        simU[4] = OPACITY_RATE
        simU[5] = JITTER_AMOUNT
        simU[6] = Math.random() * 1000
        simU[7] = count
        device.queue.writeBuffer(pipelines.simUniform, 0, simU)
      }
      if (renderUniformDirty) {
        renderU[0] = devW
        renderU[1] = devH
        renderU[2] = dpr
        renderU[3] = dotSize
        device.queue.writeBuffer(pipelines.renderUniform, 0, renderU)
        renderUniformDirty = false
      }

      const enc = device.createCommandEncoder()

      if (count > 0 && simBindGroups) {
        // One compute pass per step: WebGPU inserts a barrier between passes, so
        // the ping-pong write of pass N is visible to the read of pass N+1.
        let r = b.read
        for (let s = 0; s < steps; s++) {
          const sim = enc.beginComputePass()
          sim.setPipeline(pipelines.compute)
          sim.setBindGroup(0, simBindGroups[r])
          sim.dispatchWorkgroups(Math.ceil(count / 64))
          sim.end()
          r ^= 1
        }
        b.read = r as 0 | 1
      }

      const view = context.getCurrentTexture().createView()
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      if (count > 0) {
        pass.setPipeline(pipelines.render)
        pass.setBindGroup(0, renderBind)
        pass.setVertexBuffer(0, b.quad)
        pass.setVertexBuffer(1, b.state[b.read]!)
        pass.draw(4, count)
      }
      pass.end()
      device.queue.submit([enc.finish()])
    },
```

- [ ] **Step 4: Type-check and lint**

Run: `bun run type-check && bun run lint`
Expected: clean.

- [ ] **Step 5: Playground verify (WebGPU)**

Run `bun run dev` with `backend="webgpu"` in a WebGPU-capable browser. Confirm: dots simulate and settle exactly as before, morphs on content change look right, the shimmer is present, and resizing/dot-size changes still update. Watch the console for WebGPU validation errors (there should be none).

- [ ] **Step 6: Commit**

```bash
git add src/backends/webgpu/index.ts
git commit -m "perf(webgpu): batch compute + render into one encoder/submit per frame"
```

---

## Task 6: Canvas2D early-sleep on convergence (lowest-confidence; last)

The engine keeps drawing for the full worst-case settle window after every change, even once the spring, color ease, and fade have all converged. Add a pure `isFieldSettled` predicate and let the engine sleep early when the active backend reports it. Thresholds are strict (stricter than the visual settle) so it can only fire after a transition has visually finished — never mid-morph. Canvas2D only (CPU has the field); GPU tiers omit it and keep timer-based sleep.

**Files:**
- Create: `src/engine/rest.ts`
- Test: `test/engine/rest.test.ts` (new)
- Modify: `src/types.ts`
- Modify: `src/backends/canvas2d/index.ts`
- Modify: `src/engine/engine.ts`

- [ ] **Step 1: Write failing tests for `isFieldSettled`**

Create `test/engine/rest.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import { isFieldSettled } from '@/engine/rest'
import type { FieldTargets } from '@/types'

function target(): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(5),
    homeY: Float32Array.of(5),
    homeR: Float32Array.of(100),
    homeG: Float32Array.of(120),
    homeB: Float32Array.of(140),
  }
}

function settled() {
  const f = reconcile(createField(1), target())
  f.x[0] = 5
  f.y[0] = 5
  f.vx[0] = 0
  f.vy[0] = 0
  f.r[0] = 100
  f.g[0] = 120
  f.b[0] = 140
  f.alpha[0] = 1 // targetAlpha is 1 after reconcile
  return f
}

describe('isFieldSettled', () => {
  test('true when velocity, color, and alpha have all converged', () => {
    expect(isFieldSettled(settled())).toBe(true)
  })

  test('false while a particle still has velocity', () => {
    const f = settled()
    f.vx[0] = 5
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while alpha is still fading in', () => {
    const f = settled()
    f.alpha[0] = 0.4
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while a fader has not finished leaving', () => {
    const f = settled()
    f.count = 1
    f.active = 0
    f.targetAlpha[0] = 0
    f.alpha[0] = 0.5
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while color is still easing toward home', () => {
    const f = settled()
    f.r[0] = 10 // far from homeR 100
    expect(isFieldSettled(f)).toBe(false)
  })

  test('true for an empty field', () => {
    expect(isFieldSettled(createField(1))).toBe(true)
  })
})
```

- [ ] **Step 2: Run; verify they fail**

Run: `bun test test/engine/rest.test.ts`
Expected: FAIL — `@/engine/rest` does not exist.

- [ ] **Step 3: Implement `isFieldSettled`**

Create `src/engine/rest.ts`:

```ts
import type { ParticleField } from '@/types'

// Strict convergence thresholds: the predicate must only return true once a
// transition has visually finished, so the engine never sleeps mid-morph. The
// cosmetic ±0.5px jitter is intentionally ignored (it perturbs position, not
// velocity, and stops anyway when the loop sleeps).
const VEL_EPS_SQ = 0.05 * 0.05 // (px/s)^2 — spring essentially stopped
const COLOR_EPS = 0.5 // within half an 8-bit level of the home color
const ALPHA_EPS = 0.01

/**
 * True when the spring, color ease, and alpha fade have converged for every
 * live slot — i.e. nothing visible will change. Pure; O(count). Used by the
 * Canvas2D backend to let the engine sleep as soon as a transition is done.
 */
export function isFieldSettled(field: ParticleField): boolean {
  const { vx, vy, r, g, b, homeR, homeG, homeB, alpha, targetAlpha } = field
  const count = field.count
  for (let i = 0; i < count; i++) {
    if (vx[i]! * vx[i]! + vy[i]! * vy[i]! > VEL_EPS_SQ) return false
    if (targetAlpha[i]! > 0.5) {
      if (alpha[i]! < 1 - ALPHA_EPS) return false
    } else if (alpha[i]! > ALPHA_EPS) {
      return false
    }
    if (Math.abs(r[i]! - homeR[i]!) > COLOR_EPS) return false
    if (Math.abs(g[i]! - homeG[i]!) > COLOR_EPS) return false
    if (Math.abs(b[i]! - homeB[i]!) > COLOR_EPS) return false
  }
  return true
}
```

- [ ] **Step 4: Run; verify the tests pass**

Run: `bun test test/engine/rest.test.ts`
Expected: PASS.

- [ ] **Step 5: Add optional `settled?()` to the `Backend` interface**

In `src/types.ts`, add to the `Backend` interface (after `draw(): void`):
```ts
  /** Optional: true when the field has visibly converged, so the engine may sleep early. */
  settled?(): boolean
```

- [ ] **Step 6: Implement `settled()` in the Canvas2D backend**

In `src/backends/canvas2d/index.ts`:

Add the import:
```ts
import { isFieldSettled } from '@/engine/rest'
```

Add a `settled` method to the returned backend object (e.g. after `draw`):
```ts
    settled(): boolean {
      return field ? isFieldSettled(field) : true
    },
```

- [ ] **Step 7: Use it in the engine's sleep check**

In `src/engine/engine.ts`, in the `loop`, change the sleep condition from:
```ts
    if (idle === 'sleep' && now >= awakeUntil) {
      stop()
      return
    }
```
to:
```ts
    if (idle === 'sleep' && (now >= awakeUntil || backend.settled?.())) {
      stop()
      return
    }
```

- [ ] **Step 8: Type-check, lint, full test run**

Run: `bun test && bun run type-check && bun run lint`
Expected: clean.

- [ ] **Step 9: Playground verify carefully**

Run `bun run dev` with `backend="canvas2d"` and `idle="sleep"` (the default). Change content and confirm: the morph plays fully and smoothly to completion (no early freeze mid-transition), then the loop sleeps (CPU drops to ~0 in devtools performance). Then test `idle="animate"` still animates continuously (the early-sleep path is gated on `idle === 'sleep'`).

- [ ] **Step 10: Commit**

```bash
git add src/engine/rest.ts src/types.ts src/backends/canvas2d/index.ts src/engine/engine.ts test/engine/rest.test.ts
git commit -m "perf(engine): sleep early once the Canvas2D field has converged"
```

---

## Self-Review

**Spec coverage:**
- #1 Canvas2D full-buffer clear + upload → Task 1 ✅
- #6 reciprocal blend → Task 1 Step 8 ✅; #6 WebGL2 viewport/clearColor → Task 4 ✅
- #4 sampler shuffle cost (reframed to preserve the look) → Task 2 ✅
- #5 GPU pack allocations → Task 3 ✅
- #3 WebGPU multiple submits → Task 5 ✅
- #7 early-sleep on convergence → Task 6 ✅
- #2 OffscreenCanvas worker → intentionally deferred (documented in header).

**Placeholder scan:** No TODO/TBD/"handle edge cases"; every code step shows complete code.

**Type consistency:** `DirtyRect` used consistently across `computeDirtyRect`/`unionRect`/`renderField`/`canvas2d`. `packStateInto(out, field, start, end)` and `packTargetsInto(out, field, count)` signatures match between WebGL2 and WebGPU backends and their callers. `isFieldSettled(field)` and `Backend.settled?()` match between `rest.ts`, `types.ts`, the Canvas2D backend, and the engine.

**Ordering rationale:** Fully unit-testable, highest-impact, self-contained work first (Tasks 1–3); GPU/playground-only micro/structure next (Tasks 4–5); the lowest-confidence engine-behavior change last (Task 6), so execution can stop before it if appetite runs out.
