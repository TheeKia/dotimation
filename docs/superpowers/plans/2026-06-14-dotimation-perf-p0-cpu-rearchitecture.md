# Dotimation P0 — CPU Re-architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the array-of-objects particle engine with a Structure-of-Arrays model, a unified single-buffer morph, a settle/sleep loop, and a backend-agnostic orchestrator — shipping a refactored Canvas2D backend with zero visual regression.

**Architecture:** A shared orchestrator owns timing/settle/resize/visibility and drives a `Backend` through a narrow contract (`uploadField` / `step` / `draw` / `resize` / `dispose`). Every module is split into a **pure core** (typed-array logic, unit-tested under `bun test` with no DOM) and a **thin DOM shell** (verified in the `test/ui` playground). P0 ships only the Canvas2D backend; the selection layer is scaffolded so WebGL2/WebGPU drop in during P1/P2.

**Tech Stack:** TypeScript (strict, `isolatedDeclarations`), React 19, Bun (test runner + bundler via bunup), Biome (lint/format). Canvas2D `ImageData`/`Uint32Array` rendering.

---

## Conventions for every task

- **Tests** live under `test/` mirroring `src/` (e.g. `src/engine/field.ts` → `test/engine/field.test.ts`). Bun discovers `*.test.ts`. Import source with the `@/` alias (Bun honors `tsconfig.json` `paths`).
- **`isolatedDeclarations: true`** — every exported function/const needs an explicit return type. Add them or `type-check` fails.
- **`noUncheckedIndexedAccess: true`** — indexed access is `T | undefined`; use `!` where an index is provably valid (Biome's `noNonNullAssertion` is off).
- **Formatting** is Biome-owned: single quotes, no semicolons, 2-space indent. Run `bun run lint:fix` before committing.
- **Run a single test file:** `bun test test/engine/field.test.ts`. **Single test:** `bun test -t "grows capacity"`.
- **Commit** after each task with the pre-commit hook green (`bun run lint && bun run type-check` run automatically).

## Shared type contracts (defined in Task 1, referenced everywhere)

```ts
// Rasterizer output: the desired layout, home positions/colors only.
export interface FieldTargets {
  count: number
  homeX: Float32Array
  homeY: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
}

// Live simulation state, Structure-of-Arrays.
// Slots [0, active) are the current layout (targetAlpha = 1).
// Slots [active, count) are faders leaving the layout (targetAlpha = 0).
export interface ParticleField {
  active: number
  count: number
  capacity: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  homeX: Float32Array
  homeY: Float32Array
  r: Float32Array
  g: Float32Array
  b: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
  alpha: Float32Array
  targetAlpha: Float32Array
}

// Backend contract (Task 10).
export interface Backend {
  init(canvas: HTMLCanvasElement, dpr: number): Promise<void> | void
  uploadField(field: ParticleField): void
  step(dt: number): void
  draw(): void
  resize(devW: number, devH: number): void
  dispose(): void
}
```

Color channels are stored as `Float32Array` (0–255) in P0: easeable directly, and float is the GPU upload format P1/P2 want anyway.

---

## Task 1: Public + internal types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace `Particle` with the new contracts**

Replace the entire contents of `src/types.ts` with:

```ts
export type AnimateItem =
  | {
      type: 'text'
      data: string
      fontFamily?: string
      fontSize?: number | 'AUTO' | 'AUTO_MONO'
      textColor?: string | CanvasGradient | CanvasPattern
    }
  | {
      type: 'image'
      data: string
      maxWidth?: number
      maxHeight?: number
      invert?: boolean
    }

/** Which rendering/simulation backend to use. `'auto'` picks the best available. */
export type BackendKind = 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'

/** Whether the animation stops the rAF loop once particles settle. */
export type IdleBehavior = 'sleep' | 'animate'

/** Rasterizer output: the desired layout (home positions/colors only). */
export interface FieldTargets {
  count: number
  homeX: Float32Array
  homeY: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
}

/**
 * Live simulation state in Structure-of-Arrays form.
 * Slots [0, active) are the current layout (targetAlpha = 1).
 * Slots [active, count) are faders leaving the layout (targetAlpha = 0).
 */
export interface ParticleField {
  active: number
  count: number
  capacity: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  homeX: Float32Array
  homeY: Float32Array
  r: Float32Array
  g: Float32Array
  b: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
  alpha: Float32Array
  targetAlpha: Float32Array
}

export interface Backend {
  init(canvas: HTMLCanvasElement, dpr: number): Promise<void> | void
  uploadField(field: ParticleField): void
  step(dt: number): void
  draw(): void
  resize(devW: number, devH: number): void
  dispose(): void
}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS (no other file imports `Particle` yet at this point except old engine files; if it errors on `src/components/dotimation.tsx` / `src/animations/fps.ts` / `src/hooks/use-initial-particles.ts`, that is expected — those are replaced in Tasks 9–15. To keep the tree compiling between tasks, leave the old files in place for now; they are deleted in Task 15.)

> Note: because the old files still import the removed `Particle` type, `type-check` will fail until Task 15. That is acceptable mid-plan. Each task below still runs its own unit tests (which only import new modules) green. Do the final full `type-check` gate in Task 15.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add SoA ParticleField + Backend type contracts"
```

---

## Task 2: ParticleField allocation

**Files:**
- Create: `src/engine/field.ts`
- Test: `test/engine/field.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/engine/field.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createField, growField, nextPow2 } from '@/engine/field'

describe('nextPow2', () => {
  test('rounds up to next power of two', () => {
    expect(nextPow2(1)).toBe(1)
    expect(nextPow2(5)).toBe(8)
    expect(nextPow2(1024)).toBe(1024)
    expect(nextPow2(1025)).toBe(2048)
  })
})

describe('createField', () => {
  test('allocates all arrays at capacity with zero counts', () => {
    const f = createField(10)
    expect(f.capacity).toBe(16)
    expect(f.active).toBe(0)
    expect(f.count).toBe(0)
    expect(f.x.length).toBe(16)
    expect(f.targetAlpha.length).toBe(16)
  })
})

describe('growField', () => {
  test('grows capacity and preserves existing data', () => {
    const f = createField(2)
    f.x[0] = 3.5
    f.active = 1
    f.count = 1
    const g = growField(f, 100)
    expect(g.capacity).toBe(128)
    expect(g.x[0]).toBe(3.5)
    expect(g.active).toBe(1)
    expect(g.count).toBe(1)
  })

  test('returns same field when capacity already sufficient', () => {
    const f = createField(16)
    expect(growField(f, 10)).toBe(f)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/field.test.ts`
Expected: FAIL — `Cannot find module '@/engine/field'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/field.ts`:

```ts
import type { ParticleField } from '@/types'

const ARRAY_KEYS = [
  'x',
  'y',
  'vx',
  'vy',
  'homeX',
  'homeY',
  'r',
  'g',
  'b',
  'homeR',
  'homeG',
  'homeB',
  'alpha',
  'targetAlpha',
] as const

export function nextPow2(n: number): number {
  if (n <= 1) return 1
  return 2 ** Math.ceil(Math.log2(n))
}

export function createField(capacity: number): ParticleField {
  const cap = nextPow2(Math.max(1, capacity))
  return {
    active: 0,
    count: 0,
    capacity: cap,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    homeX: new Float32Array(cap),
    homeY: new Float32Array(cap),
    r: new Float32Array(cap),
    g: new Float32Array(cap),
    b: new Float32Array(cap),
    homeR: new Float32Array(cap),
    homeG: new Float32Array(cap),
    homeB: new Float32Array(cap),
    alpha: new Float32Array(cap),
    targetAlpha: new Float32Array(cap),
  }
}

export function growField(field: ParticleField, minCapacity: number): ParticleField {
  if (field.capacity >= minCapacity) return field
  const next = createField(minCapacity)
  next.active = field.active
  next.count = field.count
  for (const key of ARRAY_KEYS) next[key].set(field[key])
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/field.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/field.ts test/engine/field.test.ts
git commit -m "feat: ParticleField allocation (createField/growField/nextPow2)"
```

---

## Task 3: Unified morph reconcile

**Files:**
- Modify: `src/engine/field.ts`
- Test: `test/engine/reconcile.test.ts`

The reconcile maps the previous layout onto new targets in one fixed-capacity buffer.
- **First load** (`count === 0`): place actives at home, `alpha = 0`, `targetAlpha = 1` (fade in place).
- **Shrink** (`newActive <= oldActive`): retarget the kept actives; flip surplus `[newActive, count)` to `targetAlpha = 0` (fade out). Nothing moves.
- **Growth** (`newActive > oldActive`): relocate any in-flight faders rightward to `[newActive, …)`, seed new actives `[oldActive, newActive)` from existing actives (fly-in), retarget all actives.

- [ ] **Step 1: Write the failing test**

Create `test/engine/reconcile.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import type { FieldTargets } from '@/types'

function targets(positions: [number, number][]): FieldTargets {
  const n = positions.length
  const t: FieldTargets = {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    homeR: new Float32Array(n),
    homeG: new Float32Array(n),
    homeB: new Float32Array(n),
  }
  positions.forEach(([x, y], i) => {
    t.homeX[i] = x
    t.homeY[i] = y
    t.homeR[i] = 10
    t.homeG[i] = 20
    t.homeB[i] = 30
  })
  return t
}

describe('reconcile — first load', () => {
  test('places actives at home with alpha 0, targetAlpha 1', () => {
    const f = reconcile(createField(1), targets([[5, 6], [7, 8]]))
    expect(f.active).toBe(2)
    expect(f.count).toBe(2)
    expect(f.x[0]).toBe(5)
    expect(f.y[0]).toBe(6)
    expect(f.homeX[1]).toBe(7)
    expect(f.alpha[0]).toBe(0)
    expect(f.targetAlpha[0]).toBe(1)
    expect(f.vx[0]).toBe(0)
  })
})

describe('reconcile — shrink', () => {
  test('keeps actives, fades surplus, count unchanged', () => {
    let f = reconcile(createField(1), targets([[0, 0], [1, 1], [2, 2], [3, 3]]))
    f = reconcile(f, targets([[9, 9], [8, 8]]))
    expect(f.active).toBe(2)
    expect(f.count).toBe(4)
    expect(f.homeX[0]).toBe(9)
    expect(f.targetAlpha[0]).toBe(1)
    expect(f.targetAlpha[2]).toBe(0)
    expect(f.targetAlpha[3]).toBe(0)
  })
})

describe('reconcile — growth', () => {
  test('seeds new actives from existing and retargets', () => {
    let f = reconcile(createField(1), targets([[0, 0], [1, 1]]))
    // mark current positions so we can detect seeding
    f.x[0] = 100
    f.y[0] = 200
    f = reconcile(f, targets([[5, 5], [6, 6], [7, 7], [8, 8]]))
    expect(f.active).toBe(4)
    expect(f.count).toBe(4)
    // new active slot 2 seeded from an existing active (slot 0 or 1)
    expect([f.x[2]]).toContainEqual(expect.any(Number))
    expect(f.homeX[2]).toBe(7)
    expect(f.targetAlpha[3]).toBe(1)
  })

  test('grows capacity when targets exceed it', () => {
    const f = reconcile(createField(2), targets(Array.from({ length: 50 }, (_, i) => [i, i] as [number, number])))
    expect(f.capacity).toBeGreaterThanOrEqual(50)
    expect(f.active).toBe(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/reconcile.test.ts`
Expected: FAIL — `reconcile` not exported from `@/engine/field`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/field.ts`:

```ts
import type { FieldTargets } from '@/types'

function copySlot(field: ParticleField, src: number, dst: number): void {
  for (const key of ARRAY_KEYS) field[key][dst] = field[key][src]!
}

function retargetActive(field: ParticleField, i: number, t: FieldTargets): void {
  field.homeX[i] = t.homeX[i]!
  field.homeY[i] = t.homeY[i]!
  field.homeR[i] = t.homeR[i]!
  field.homeG[i] = t.homeG[i]!
  field.homeB[i] = t.homeB[i]!
  field.targetAlpha[i] = 1
}

export function reconcile(field: ParticleField, targets: FieldTargets): ParticleField {
  const newActive = targets.count
  const oldActive = field.active
  const oldCount = field.count
  const oldFaders = oldCount - oldActive

  const f = growField(field, Math.max(oldCount, newActive + oldFaders))

  if (oldCount === 0) {
    for (let i = 0; i < newActive; i++) {
      f.x[i] = targets.homeX[i]!
      f.y[i] = targets.homeY[i]!
      f.vx[i] = 0
      f.vy[i] = 0
      f.r[i] = targets.homeR[i]!
      f.g[i] = targets.homeG[i]!
      f.b[i] = targets.homeB[i]!
      f.alpha[i] = 0
      retargetActive(f, i, targets)
    }
    f.active = newActive
    f.count = newActive
    return f
  }

  if (newActive <= oldActive) {
    // Shrink: surplus actives become faders in place; nothing moves.
    for (let i = 0; i < newActive; i++) retargetActive(f, i, targets)
    for (let i = newActive; i < oldCount; i++) f.targetAlpha[i] = 0
    f.active = newActive
    f.count = oldCount
    return f
  }

  // Growth: relocate existing faders rightward (descending to avoid clobber).
  for (let j = oldFaders - 1; j >= 0; j--) copySlot(f, oldActive + j, newActive + j)
  // Seed new actives from existing actives (fly-in origin).
  for (let i = oldActive; i < newActive; i++) {
    copySlot(f, i % oldActive, i)
    f.vx[i] = 0
    f.vy[i] = 0
    f.alpha[i] = 0
  }
  for (let i = 0; i < newActive; i++) retargetActive(f, i, targets)
  f.active = newActive
  f.count = newActive + oldFaders
  return f
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/field.ts test/engine/reconcile.test.ts
git commit -m "feat: unified single-buffer morph reconcile"
```

---

## Task 4: Pure pixel sampler

**Files:**
- Create: `src/raster/sample.ts`
- Test: `test/raster/sample.test.ts`

Pure: a device-pixel RGBA buffer + geometry → `FieldTargets`. No DOM. Mirrors the current sampling in `src/utils/utils.ts:97-124` (grid step, alpha threshold, Fisher–Yates) but emits SoA and is seedable for deterministic tests.

- [ ] **Step 1: Write the failing test**

Create `test/raster/sample.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { sampleTargets } from '@/raster/sample'

// 2x2 device image, dpr 1, step 1, one opaque red pixel at (1,0).
function img(): Uint8ClampedArray {
  const p = new Uint8ClampedArray(2 * 2 * 4)
  const idx = (0 * 2 + 1) * 4
  p[idx] = 255
  p[idx + 1] = 0
  p[idx + 2] = 0
  p[idx + 3] = 255
  return p
}

describe('sampleTargets', () => {
  test('emits one target at the opaque pixel in CSS coords', () => {
    const t = sampleTargets(img(), 2, 2, 1, 1, 128, () => 0)
    expect(t.count).toBe(1)
    expect(t.homeX[0]).toBe(1)
    expect(t.homeY[0]).toBe(0)
    expect(t.homeR[0]).toBe(255)
    expect(t.homeB[0]).toBe(0)
  })

  test('skips pixels at or below the alpha threshold', () => {
    const p = img()
    p[(0 * 2 + 1) * 4 + 3] = 128 // exactly threshold → excluded (> alpha)
    expect(sampleTargets(p, 2, 2, 1, 1, 128, () => 0).count).toBe(0)
  })

  test('converts device coords to CSS using dpr', () => {
    const p = new Uint8ClampedArray(4 * 4 * 4)
    const idx = (2 * 4 + 2) * 4
    p[idx + 3] = 255
    const t = sampleTargets(p, 4, 4, 2, 1, 128, () => 0)
    expect(t.homeX[0]).toBe(1) // 2 device px / dpr 2
    expect(t.homeY[0]).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/raster/sample.test.ts`
Expected: FAIL — `Cannot find module '@/raster/sample'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/raster/sample.ts`:

```ts
import type { FieldTargets } from '@/types'

/**
 * Samples a device-pixel RGBA buffer into FieldTargets. Pure and DOM-free.
 * `rand` is injectable for deterministic tests (defaults to Math.random).
 */
export function sampleTargets(
  pixels: Uint8ClampedArray,
  devW: number,
  devH: number,
  dpr: number,
  pointSpacingCss: number,
  alpha: number,
  rand: () => number = Math.random,
): FieldTargets {
  const step = Math.max(1, Math.round(pointSpacingCss * dpr))
  const xs: number[] = []
  const ys: number[] = []
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []

  for (let yDev = 0; yDev < devH; yDev += step) {
    for (let xDev = 0; xDev < devW; xDev += step) {
      const idx = (yDev * devW + xDev) * 4
      if (pixels[idx + 3]! > alpha) {
        xs.push(xDev / dpr)
        ys.push(yDev / dpr)
        rs.push(pixels[idx]!)
        gs.push(pixels[idx + 1]!)
        bs.push(pixels[idx + 2]!)
      }
    }
  }

  const n = xs.length
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    const tmp = order[i]!
    order[i] = order[j]!
    order[j] = tmp
  }

  const t: FieldTargets = {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    homeR: new Float32Array(n),
    homeG: new Float32Array(n),
    homeB: new Float32Array(n),
  }
  for (let i = 0; i < n; i++) {
    const k = order[i]!
    t.homeX[i] = xs[k]!
    t.homeY[i] = ys[k]!
    t.homeR[i] = rs[k]!
    t.homeG[i] = gs[k]!
    t.homeB[i] = bs[k]!
  }
  return t
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/raster/sample.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/raster/sample.ts test/raster/sample.test.ts
git commit -m "feat: pure pixel sampler (pixels -> FieldTargets)"
```

---

## Task 5: Rasterizer DOM shell

**Files:**
- Create: `src/raster/rasterize.ts`
- Modify: `src/utils/utils.ts` (keep `getCtx`, drop the old `initParticles`)

This is the thin DOM shell: draw the `AnimateItem` to a canvas, read pixels, call `sampleTargets`. It reuses the existing text/image drawing and `getCtx` verbatim. No unit test (DOM-bound); verified in the playground in Task 16.

- [ ] **Step 1: Trim `utils.ts` to just `getCtx`**

In `src/utils/utils.ts`, delete `getScale`, `DEFAULT_TEXT_COLOR`, and `initParticles` (lines 1–133), keeping only `getCtx` (lines 135–150) and its needed imports removed. The file becomes:

```ts
export function getCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  return ctx
}
```

- [ ] **Step 2: Create the rasterizer**

Create `src/raster/rasterize.ts`:

```ts
import type { AnimateItem, FieldTargets } from '@/types'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'
import { getCtx } from '@/utils/utils'
import { sampleTargets } from './sample'

const DEFAULT_TEXT_COLOR = 'rgb(200,200,200)'

function getScale(
  width: number,
  height: number,
  image: HTMLImageElement,
  item: Extract<AnimateItem, { type: 'image' }>,
): number {
  const wScale = item.maxWidth ? item.maxWidth / image.width : Number.POSITIVE_INFINITY
  const hScale = item.maxHeight ? item.maxHeight / image.height : Number.POSITIVE_INFINITY
  const userScale = Math.min(wScale, hScale)
  const scaleLimit = Math.min(width / image.width, height / image.height)
  return Math.min(userScale, scaleLimit)
}

export async function rasterize(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
): Promise<FieldTargets> {
  const empty: FieldTargets = {
    count: 0,
    homeX: new Float32Array(0),
    homeY: new Float32Array(0),
    homeR: new Float32Array(0),
    homeG: new Float32Array(0),
    homeB: new Float32Array(0),
  }

  const canvas = document.createElement('canvas')
  const ctx = getCtx(canvas, width, height)
  if (!ctx) return empty

  if (item.type === 'image') {
    const image = new Image()
    image.src = item.data
    image.crossOrigin = 'anonymous'
    await image.decode()
    const scale = getScale(width, height, image, item)
    const sw = image.width * scale
    const sh = image.height * scale
    const x = (width - sw) / 2
    const y = (height - sh) / 2
    if (item.invert) {
      ctx.save()
      ctx.filter = 'invert(1)'
      ctx.drawImage(image, x, y, sw, sh)
      ctx.restore()
    } else {
      ctx.drawImage(image, x, y, sw, sh)
    }
  } else {
    let fontSize: number
    if (item.fontSize === 'AUTO_MONO') {
      fontSize = getMonospaceFontSize(width, item.data)
    } else if (item.fontSize === 'AUTO' || item.fontSize === undefined) {
      fontSize = getAutoFontSize(width, item.data)
    } else {
      fontSize = item.fontSize
    }
    ctx.font = `${fontSize}px ${item.fontFamily || defaultFontFamily}`
    ctx.fillStyle = item.textColor || DEFAULT_TEXT_COLOR
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = item.data.split('\n')
    const lineHeight = fontSize * 1.2
    const startY = (height - lines.length * lineHeight) / 2 + lineHeight / 2
    lines.forEach((line, index) => ctx.fillText(line, width / 2, startY + index * lineHeight))
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const devW = canvas.width
  const devH = canvas.height
  const img = ctx.getImageData(0, 0, devW, devH)
  return sampleTargets(img.data, devW, devH, dpr, pointSpacingCss, alpha)
}
```

- [ ] **Step 3: Type-check the new modules in isolation**

Run: `bun test test/raster/sample.test.ts`
Expected: PASS (still green; sampler unchanged).

> Full `type-check` still fails because of the not-yet-deleted old engine (Task 15). That is expected.

- [ ] **Step 4: Commit**

```bash
bun run lint:fix && git add src/raster/rasterize.ts src/utils/utils.ts
git commit -m "feat: rasterizer DOM shell on the pure sampler; trim utils to getCtx"
```

---

## Task 6: Spring tuning + settle duration

**Files:**
- Create: `src/engine/settle.ts`
- Test: `test/engine/settle.test.ts`

Pure. `tuneSpring` is lifted from `src/animations/fps.ts:5-16`. `computeSettleDuration` returns how long (seconds) until the worst-case particle is at rest AND faded — the engine uses it for the deterministic wake budget.

- [ ] **Step 1: Write the failing test**

Create `test/engine/settle.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { computeSettleDuration, tuneSpring } from '@/engine/settle'

describe('tuneSpring', () => {
  test('critically damped (zeta 1) gives c^2 == 4k', () => {
    const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })
    expect(c * c).toBeCloseTo(4 * k, 5)
  })
})

describe('computeSettleDuration', () => {
  test('covers spring settle plus opacity fade', () => {
    // settleTime 0.85 spring; opacityRate 2 => full fade ~ 1/2 s; margin included.
    const d = computeSettleDuration(0.85, 2)
    expect(d).toBeGreaterThanOrEqual(0.85)
    expect(d).toBeLessThan(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/settle.test.ts`
Expected: FAIL — `Cannot find module '@/engine/settle'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/settle.ts`:

```ts
export function tuneSpring({ settleTime, zeta }: { settleTime: number; zeta: number }): {
  k: number
  c: number
} {
  const wn = 4 / (zeta * settleTime)
  return { k: wn * wn, c: 2 * zeta * wn }
}

/**
 * Worst-case seconds until particles are both at rest and fully faded.
 * `settleTime` is the spring settle target; `opacityRate` is the per-second
 * fade rate (alpha goes 0→1 or 1→0 at this rate). A safety margin is added so
 * the loop never sleeps a frame early.
 */
export function computeSettleDuration(settleTime: number, opacityRate: number): number {
  const fadeTime = 1 / opacityRate
  return Math.max(settleTime, fadeTime) + settleTime * 0.5 + 0.25
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/settle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/settle.ts test/engine/settle.test.ts
git commit -m "feat: spring tuning + deterministic settle duration"
```

---

## Task 7: Canvas2D simulation step

**Files:**
- Create: `src/backends/canvas2d/simulate.ts`
- Test: `test/backends/canvas2d/simulate.test.ts`

Pure: advances a `ParticleField` by `dt` (spring integration, color ease, alpha toward `targetAlpha`) and compacts dead faders. Ported from `src/animations/fps.ts:72-116` but over SoA and with the unified fader model. Jitter uses an injectable `rand` for determinism.

- [ ] **Step 1: Write the failing test**

Create `test/backends/canvas2d/simulate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import { tuneSpring } from '@/engine/settle'
import { stepField } from '@/backends/canvas2d/simulate'
import type { FieldTargets } from '@/types'

function one(x: number, y: number): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(x),
    homeY: Float32Array.of(y),
    homeR: Float32Array.of(200),
    homeG: Float32Array.of(200),
    homeB: Float32Array.of(200),
  }
}

const spring = tuneSpring({ settleTime: 0.85, zeta: 1 })

describe('stepField', () => {
  test('moves a particle toward home and fades it in', () => {
    const f = reconcile(createField(1), one(50, 50))
    f.x[0] = 0
    f.y[0] = 0
    for (let i = 0; i < 200; i++) stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    expect(f.x[0]).toBeCloseTo(50, 0)
    expect(f.alpha[0]).toBeCloseTo(1, 2)
  })

  test('compacts a fully faded fader out of count', () => {
    let f = reconcile(createField(1), one(0, 0))
    f.alpha[0] = 1
    f = reconcile(f, { ...one(0, 0), count: 0 }) // shrink to zero actives → slot 0 fades
    expect(f.count).toBe(1)
    for (let i = 0; i < 500; i++) stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    expect(f.count).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/backends/canvas2d/simulate.test.ts`
Expected: FAIL — `Cannot find module '@/backends/canvas2d/simulate'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backends/canvas2d/simulate.ts`:

```ts
import type { ParticleField } from '@/types'

const COLOR_RATE = 2
const OPACITY_RATE = 2
const JITTER_AMOUNT = 1

function expLerp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/**
 * Advances every slot one fixed step and compacts dead faders (slots with
 * targetAlpha 0 that have faded below epsilon) off the tail. `rand` is
 * injectable for deterministic tests.
 */
export function stepField(
  field: ParticleField,
  dt: number,
  k: number,
  c: number,
  rand: () => number = Math.random,
): void {
  const { x, y, vx, vy, homeX, homeY, r, g, b, homeR, homeG, homeB, alpha, targetAlpha } = field

  for (let i = 0; i < field.count; i++) {
    const ax = k * (homeX[i]! - x[i]!) - c * vx[i]!
    const ay = k * (homeY[i]! - y[i]!) - c * vy[i]!
    vx[i]! += ax * dt
    vy[i]! += ay * dt
    x[i]! += vx[i]! * dt + (rand() - 0.5) * JITTER_AMOUNT
    y[i]! += vy[i]! * dt
    r[i] = expLerp(r[i]!, homeR[i]!, COLOR_RATE, dt)
    g[i] = expLerp(g[i]!, homeG[i]!, COLOR_RATE, dt)
    b[i] = expLerp(b[i]!, homeB[i]!, COLOR_RATE, dt)
    const delta = OPACITY_RATE * dt
    alpha[i] =
      targetAlpha[i]! > 0.5
        ? Math.min(1, alpha[i]! + delta)
        : Math.max(0, alpha[i]! - delta)
  }

  // Compact dead faders (targetAlpha 0 and alpha ~ 0) from the tail.
  let i = field.count
  while (i > field.active) {
    i--
    if (targetAlpha[i]! < 0.5 && alpha[i]! <= 0.001) {
      const last = field.count - 1
      if (i !== last) {
        for (const key of [
          'x', 'y', 'vx', 'vy', 'homeX', 'homeY',
          'r', 'g', 'b', 'homeR', 'homeG', 'homeB', 'alpha', 'targetAlpha',
        ] as const) {
          field[key][i] = field[key][last]!
        }
      }
      field.count--
    }
  }
}
```

> Note: this jitters every step, matching the original's intent; the original gated jitter to 15 Hz. P0 keeps behavior visually equivalent and simpler. If profiling shows it matters, re-add the jitter clock in P3.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/backends/canvas2d/simulate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/backends/canvas2d/simulate.ts test/backends/canvas2d/simulate.test.ts
git commit -m "feat: Canvas2D SoA simulation step with fader compaction"
```

---

## Task 8: Canvas2D pixel renderer

**Files:**
- Create: `src/backends/canvas2d/render.ts`
- Test: `test/backends/canvas2d/render.test.ts`

Pure: writes a `ParticleField` into a `Uint32Array` view of an `ImageData` buffer. Ported from `src/animations/fps.ts:118-176` with the **endianness branch hoisted out of the per-pixel loop**, and `dotSize` support (square footprint in device px). Operates on a plain `Uint32Array`, so it is fully unit-testable with no DOM.

- [ ] **Step 1: Write the failing test**

Create `test/backends/canvas2d/render.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import { renderField } from '@/backends/canvas2d/render'
import type { FieldTargets } from '@/types'

function one(x: number, y: number): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(x),
    homeY: Float32Array.of(y),
    homeR: Float32Array.of(255),
    homeG: Float32Array.of(0),
    homeB: Float32Array.of(0),
  }
}

describe('renderField', () => {
  test('writes an opaque red pixel at the particle position', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.r[0] = 255
    f.g[0] = 0
    f.b[0] = 0
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 1)
    expect(view[3 * 8 + 2]).not.toBe(0) // pixel set
    // count non-zero pixels == 1 for dotSize 1
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(1)
  })

  test('skips fully transparent particles', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.alpha[0] = 0
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 1)
    expect(view.every((v) => v === 0)).toBe(true)
  })

  test('dotSize 2 writes a 2x2 footprint', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 2)
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: FAIL — `Cannot find module '@/backends/canvas2d/render'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backends/canvas2d/render.ts`:

```ts
import type { ParticleField } from '@/types'

const IS_LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4)
  new Uint32Array(buf)[0] = 0x01020304
  return new Uint8Array(buf)[0] === 0x04
})()

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0
}

/**
 * Renders the field into a Uint32Array view of an RGBA buffer with manual
 * source-over compositing. The endianness branch is resolved once up front,
 * not per pixel. `dotSize` is the square footprint in device pixels.
 */
export function renderField(
  view: Uint32Array,
  field: ParticleField,
  devW: number,
  devH: number,
  dpr: number,
  dotSize: number,
): void {
  view.fill(0)
  const size = Math.max(1, dotSize | 0)
  const little = IS_LITTLE_ENDIAN

  const pack = little
    ? (r: number, g: number, b: number, a: number): number =>
        ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : (r: number, g: number, b: number, a: number): number =>
        ((r << 24) | (g << 16) | (b << 8) | a) >>> 0

  for (let i = 0; i < field.count; i++) {
    const sa = field.alpha[i]!
    if (sa <= 0) continue
    const clampedA = sa >= 1 ? 1 : sa
    const sr = clamp255(field.r[i]!)
    const sg = clamp255(field.g[i]!)
    const sb = clamp255(field.b[i]!)
    const baseX = (field.x[i]! * dpr + 0.5) | 0
    const baseY = (field.y[i]! * dpr + 0.5) | 0

    for (let oy = 0; oy < size; oy++) {
      const yDev = baseY + oy
      if (yDev < 0 || yDev >= devH) continue
      for (let ox = 0; ox < size; ox++) {
        const xDev = baseX + ox
        if (xDev < 0 || xDev >= devW) continue
        const idx = yDev * devW + xDev
        const dst = view[idx]!
        if (dst === 0) {
          view[idx] = pack(sr, sg, sb, (clampedA * 255 + 0.5) | 0)
          continue
        }
        const dr = little ? dst & 0xff : (dst >>> 24) & 0xff
        const dg = little ? (dst >>> 8) & 0xff : (dst >>> 16) & 0xff
        const db = little ? (dst >>> 16) & 0xff : (dst >>> 8) & 0xff
        const da = (little ? (dst >>> 24) & 0xff : dst & 0xff) / 255
        const outA = clampedA + da * (1 - clampedA)
        if (outA <= 0) continue
        const outR = (sr * clampedA + dr * da * (1 - clampedA)) / outA
        const outG = (sg * clampedA + dg * da * (1 - clampedA)) / outA
        const outB = (sb * clampedA + db * da * (1 - clampedA)) / outA
        view[idx] = pack((outR + 0.5) | 0, (outG + 0.5) | 0, (outB + 0.5) | 0, (outA * 255 + 0.5) | 0)
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/backends/canvas2d/render.ts test/backends/canvas2d/render.test.ts
git commit -m "feat: Canvas2D pixel renderer (hoisted endianness, dotSize)"
```

---

## Task 9: Canvas2D backend (Backend impl)

**Files:**
- Create: `src/backends/canvas2d/index.ts`

Thin DOM shell wiring `ctx` + `ImageData` to `stepField`/`renderField`. No unit test (DOM-bound); verified in the playground (Task 16).

- [ ] **Step 1: Implement the backend**

Create `src/backends/canvas2d/index.ts`:

```ts
import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import { renderField } from './render'
import { stepField } from './simulate'

export interface Canvas2DOptions {
  dotSize: number
}

export function createCanvas2DBackend(opts: Canvas2DOptions): Backend {
  let ctx: CanvasRenderingContext2D | null = null
  let imageData: ImageData | null = null
  let view: Uint32Array | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let field: ParticleField | null = null
  const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })

  function ensureBuffer(): void {
    if (!ctx) return
    if (!imageData || imageData.width !== devW || imageData.height !== devH) {
      imageData = ctx.createImageData(devW, devH)
      view = new Uint32Array(imageData.data.buffer)
    }
  }

  return {
    init(canvas, devicePixelRatio): void {
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      ctx = canvas.getContext('2d')
      if (ctx) ctx.imageSmoothingEnabled = false
      ensureBuffer()
    },
    uploadField(next): void {
      field = next
    },
    step(dt): void {
      if (field) stepField(field, dt, k, c)
    },
    draw(): void {
      if (!ctx || !field) return
      ensureBuffer()
      if (!imageData || !view) return
      renderField(view, field, devW, devH, dpr, opts.dotSize)
      ctx.putImageData(imageData, 0, 0)
    },
    resize(w, h): void {
      devW = w
      devH = h
      imageData = null
      view = null
      ensureBuffer()
    },
    dispose(): void {
      ctx = null
      imageData = null
      view = null
      field = null
    },
  }
}
```

- [ ] **Step 2: Lint + commit**

```bash
bun run lint:fix && git add src/backends/canvas2d/index.ts
git commit -m "feat: Canvas2D Backend implementation"
```

---

## Task 10: Backend capability detection

**Files:**
- Create: `src/engine/backend.ts`
- Test: `test/engine/backend.test.ts`

Pure detection helpers (P1/P2 use these to pick GPU tiers). In P0 they let `select.ts` and tests reason about capability without a real GPU.

- [ ] **Step 1: Write the failing test**

Create `test/engine/backend.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { resolveBackendKind } from '@/engine/backend'

describe('resolveBackendKind', () => {
  test('honors an explicit non-auto choice', () => {
    expect(resolveBackendKind('canvas2d', { webgpu: true, webgl2: true })).toBe('canvas2d')
    expect(resolveBackendKind('webgl2', { webgpu: true, webgl2: true })).toBe('webgl2')
  })

  test('auto prefers webgpu, then webgl2, then canvas2d', () => {
    expect(resolveBackendKind('auto', { webgpu: true, webgl2: true })).toBe('webgpu')
    expect(resolveBackendKind('auto', { webgpu: false, webgl2: true })).toBe('webgl2')
    expect(resolveBackendKind('auto', { webgpu: false, webgl2: false })).toBe('canvas2d')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/backend.test.ts`
Expected: FAIL — `Cannot find module '@/engine/backend'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/backend.ts`:

```ts
import type { BackendKind } from '@/types'

export interface Capabilities {
  webgpu: boolean
  webgl2: boolean
}

/** Resolves an `'auto'` request (or honors an explicit one) against capabilities. */
export function resolveBackendKind(
  requested: BackendKind,
  caps: Capabilities,
): Exclude<BackendKind, 'auto'> {
  if (requested !== 'auto') return requested
  if (caps.webgpu) return 'webgpu'
  if (caps.webgl2) return 'webgl2'
  return 'canvas2d'
}

/** Detects available GPU tiers. DOM-bound; returns all-false outside a browser. */
export function detectCapabilities(): Capabilities {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return { webgpu: false, webgl2: false }
  }
  const webgpu = 'gpu' in navigator
  let webgl2 = false
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return { webgpu, webgl2 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/backend.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/backend.ts test/engine/backend.test.ts
git commit -m "feat: backend capability detection + resolution"
```

---

## Task 11: Backend selection (P0 = canvas2d only)

**Files:**
- Create: `src/engine/select.ts`

P0 only ships Canvas2D. The selector resolves the kind, and for `webgpu`/`webgl2` (not yet implemented) it logs a dev note and falls back to Canvas2D. P1/P2 replace the fallthrough with dynamic `import()`. No unit test (constructs a DOM backend); the resolution logic is already tested in Task 10.

- [ ] **Step 1: Implement the selector**

Create `src/engine/select.ts`:

```ts
import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities, resolveBackendKind } from './backend'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
}

/**
 * Resolves and constructs the best available backend. In P0 only Canvas2D is
 * implemented; GPU tiers fall back to it. P1/P2 swap the fallback for dynamic
 * import of the WebGL2/WebGPU backends.
 */
export function selectBackend(opts: SelectOptions): Backend {
  const kind = resolveBackendKind(opts.requested, detectCapabilities())
  if (kind !== 'canvas2d') {
    // GPU backends land in P1/P2; fall back for now.
    if (typeof console !== 'undefined') {
      console.info(`[dotimation] ${kind} backend not yet available, using canvas2d`)
    }
  }
  return createCanvas2DBackend({ dotSize: opts.dotSize })
}
```

- [ ] **Step 2: Lint + commit**

```bash
bun run lint:fix && git add src/engine/select.ts
git commit -m "feat: backend selector (canvas2d in P0, GPU fallback)"
```

---

## Task 12: Frame clock (pure timing core)

**Files:**
- Create: `src/engine/clock.ts`
- Test: `test/engine/clock.test.ts`

Pure: the fixed-timestep accumulator from `src/animations/fps.ts:178-193`, extracted so the stepping math is unit-testable without rAF.

- [ ] **Step 1: Write the failing test**

Create `test/engine/clock.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { accumulate, FIXED_DT } from '@/engine/clock'

describe('accumulate', () => {
  test('emits the right number of fixed steps for a frame', () => {
    const r = accumulate(0, 1 / 30) // ~33ms frame at 90Hz fixed
    expect(r.steps).toBe(3)
    expect(r.accumulator).toBeCloseTo(1 / 30 - 3 * FIXED_DT, 6)
  })

  test('clamps a huge frame delta to maxSteps', () => {
    const r = accumulate(0, 10) // tab restored after long sleep
    expect(r.steps).toBe(8)
  })

  test('carries fractional accumulator across frames', () => {
    const a = accumulate(0, 0.008) // < one fixed step
    expect(a.steps).toBe(0)
    const b = accumulate(a.accumulator, 0.008)
    expect(b.steps).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/clock.test.ts`
Expected: FAIL — `Cannot find module '@/engine/clock'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/clock.ts`:

```ts
export const PHYSICS_HZ = 90
export const FIXED_DT = 1 / PHYSICS_HZ
export const MAX_STEPS_PER_FRAME = 8
export const MAX_FRAME_DELTA = 0.05

/**
 * Given the carried accumulator and a frame delta (seconds), returns how many
 * fixed physics steps to run and the new accumulator. Clamps the frame delta
 * and step count to survive tab-restore spikes.
 */
export function accumulate(
  accumulator: number,
  frameDelta: number,
): { steps: number; accumulator: number } {
  let acc = accumulator + Math.min(MAX_FRAME_DELTA, frameDelta)
  let steps = 0
  while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    acc -= FIXED_DT
    steps++
  }
  return { steps, accumulator: acc }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/clock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/clock.ts test/engine/clock.test.ts
git commit -m "feat: pure fixed-timestep frame clock"
```

---

## Task 13: Engine orchestrator

**Files:**
- Create: `src/engine/engine.ts`

The orchestrator owns the rAF loop, settle/sleep wake budget, resize, and visibility, driving a `Backend`. DOM-bound (rAF, `performance.now`, `IntersectionObserver`); verified in the playground. Timing math is already covered by Tasks 6 and 12.

- [ ] **Step 1: Implement the engine**

Create `src/engine/engine.ts`:

```ts
import type { Backend, IdleBehavior, ParticleField } from '@/types'
import { accumulate } from './clock'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  idle: IdleBehavior
}

const SETTLE_SECONDS = computeSettleDuration(0.85, 2)

export interface Engine {
  setField(field: ParticleField): void
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas, idle } = opts
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let awakeUntil = 0
  let visible = true

  const wake = (): void => {
    awakeUntil = performance.now() + SETTLE_SECONDS * 1000
    if (!running && visible) start()
  }

  const start = (): void => {
    if (running) return
    running = true
    last = performance.now()
    accumulator = 0
    rafId = requestAnimationFrame(loop)
  }

  const stop = (): void => {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(1 / 90)
    backend.draw()
    if (idle === 'sleep' && now >= awakeUntil) {
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            if (performance.now() < awakeUntil) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field): void {
      backend.uploadField(field)
      wake()
    },
    resize(devW, devH): void {
      backend.resize(devW, devH)
      wake()
    },
    dispose(): void {
      stop()
      io?.disconnect()
      backend.dispose()
    },
  }
}
```

- [ ] **Step 2: Lint + commit**

```bash
bun run lint:fix && git add src/engine/engine.ts
git commit -m "feat: engine orchestrator with settle/sleep + visibility"
```

---

## Task 14: Rasterize-on-change hook

**Files:**
- Create: `src/hooks/use-field-targets.ts`

Reworks `src/hooks/use-initial-particles.ts` to call the new `rasterize` and return `FieldTargets`. Keeps the `executionId` stale-guard and shallow-equality skip. DOM-bound; verified in the playground.

- [ ] **Step 1: Implement the hook**

Create `src/hooks/use-field-targets.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { rasterize } from '@/raster/rasterize'
import type { AnimateItem, FieldTargets } from '@/types'

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
): FieldTargets | null {
  const [targets, setTargets] = useState<FieldTargets | null>(null)
  const prevItem = useRef<AnimateItem | null>(null)
  const prevSize = useRef({ width: 0, height: 0 })
  const executionId = useRef(0)

  useEffect(() => {
    if (!item.data) return
    const itemChanged = !prevItem.current || !shallowEqual(prevItem.current, item)
    const sizeChanged = prevSize.current.width !== width || prevSize.current.height !== height
    if (!itemChanged && !sizeChanged) return
    prevItem.current = item
    prevSize.current = { width, height }
    const id = ++executionId.current
    rasterize(width, height, item, defaultFontFamily, alpha, pointSpacingCss).then((t) => {
      if (id === executionId.current) setTargets(t)
    })
  }, [width, height, item, defaultFontFamily, alpha, pointSpacingCss])

  return targets
}
```

- [ ] **Step 2: Lint + commit**

```bash
bun run lint:fix && git add src/hooks/use-field-targets.ts
git commit -m "feat: rasterize-on-change hook returning FieldTargets"
```

---

## Task 15: Rewrite the React component + exports; delete old engine

**Files:**
- Modify: `src/components/dotimation.tsx` (full rewrite)
- Modify: `src/index.tsx`
- Delete: `src/animations/fps.ts`, `src/hooks/use-initial-particles.ts`

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/dotimation.tsx` with:

```ts
'use client'

import { useEffect, useImperativeHandle, useRef } from 'react'
import { createEngine, type Engine } from '@/engine/engine'
import { selectBackend } from '@/engine/select'
import { createField, reconcile } from '@/engine/field'
import { useFieldTargets } from '@/hooks/use-field-targets'
import { getCtx } from '@/utils/utils'
import type { AnimateItem, BackendKind, IdleBehavior, ParticleField } from '@/types'

type DotimationProps = {
  item: AnimateItem
  width: number
  height: number
  canvasRef?: React.RefObject<HTMLCanvasElement>
  className?: string
  style?: Omit<React.CSSProperties, 'width' | 'height'>
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** @default 128 */
  alpha?: number
  /** @default 2 */
  pointSpacingCss?: number
  /** @default 1 */
  dotSize?: number
  /** @default 'auto' */
  backend?: BackendKind
  /** @default 'sleep' */
  idle?: IdleBehavior
}

export default function Dotimation({
  item,
  width,
  height,
  className,
  canvasRef,
  style,
  defaultFontFamily = 'sans-serif',
  alpha = 128,
  pointSpacingCss = 2,
  dotSize = 1,
  backend = 'auto',
  idle = 'sleep',
}: DotimationProps): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const fieldRef = useRef<ParticleField>(createField(1024))

  useImperativeHandle(canvasRef, () => ref.current!)

  const targets = useFieldTargets(item, width, height, defaultFontFamily, alpha, pointSpacingCss)

  // Create / recreate the engine when canvas geometry or backend changes.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = getCtx(canvas, width, height)
    if (!ctx) return
    const be = selectBackend({ requested: backend, dotSize })
    be.init(canvas, dpr)
    const engine = createEngine({ backend: be, canvas, dpr, idle })
    engineRef.current = engine
    fieldRef.current = createField(1024)
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [width, height, backend, dotSize, idle])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    engineRef.current.setField(fieldRef.current)
  }, [targets])

  return (
    <canvas ref={ref} className={className} width={width} height={height} style={style} />
  )
}
```

- [ ] **Step 2: Update exports**

Replace `src/index.tsx` with:

```ts
export { default as Dotimation } from '@/components/dotimation'
export * from '@/types'
```

- [ ] **Step 3: Delete the superseded engine files**

```bash
git rm src/animations/fps.ts src/hooks/use-initial-particles.ts
rmdir src/animations 2>/dev/null || true
```

- [ ] **Step 4: Full type-check + lint + test (the real gate)**

Run: `bun run type-check && bun run lint && bun test`
Expected: type-check PASS, lint PASS, all test files PASS. Fix any dangling `Particle` / `initParticles` imports surfaced here.

- [ ] **Step 5: Build smoke test**

Run: `bun run build`
Expected: `dist/index.js` + `dist/index.d.ts` emitted, no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire Dotimation onto the new engine; remove old AoS engine"
```

---

## Task 16: Playground verification + controls

**Files:**
- Modify: `test/ui/src/app.tsx`

Add `backend`, `idle`, and `dotSize` controls plus an FPS overlay so the GPU/DOM-bound paths are verified by eye and the settle/sleep is observable.

- [ ] **Step 1: Add controls + FPS overlay**

Replace `test/ui/src/app.tsx` with (existing `TEST_ITEMS` preserved, new controls added):

```tsx
import './index.css'

import clsx from 'clsx'
import { type AnimateItem, type BackendKind, Dotimation } from 'dotimation'
import { useEffect, useRef, useState } from 'react'
import { useScreen } from './hooks/use-screen'

const TEST_ITEMS: { label: string; item: AnimateItem }[] = [
  { label: 'Auto Size', item: { type: 'text', data: 'Hello\nThis is a second line', fontSize: 'AUTO', fontFamily: 'sans-serif', textColor: 'rgb(255,0,255)' } },
  { label: 'Auto Size (Short)', item: { type: 'text', data: 'Hello', fontSize: 'AUTO', fontFamily: 'sans-serif' } },
  { label: 'Auto Mono Size', item: { type: 'text', data: 'Hello\nThis is a second line', fontSize: 'AUTO_MONO', fontFamily: 'monospace' } },
  { label: 'Fixed Size', item: { type: 'text', data: 'Hi', fontSize: 30 } },
  { label: 'Image', item: { type: 'image', data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg' } },
  { label: 'Image (Inverted)', item: { type: 'image', data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg', invert: true } },
]

function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const t0 = useRef(performance.now())
  useEffect(() => {
    let id = 0
    const tick = (): void => {
      frames.current++
      const now = performance.now()
      if (now - t0.current >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - t0.current)))
        frames.current = 0
        t0.current = now
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  return fps
}

export function App() {
  const [item, setItem] = useState<AnimateItem>(TEST_ITEMS[0].item)
  const [backend, setBackend] = useState<BackendKind>('auto')
  const [dotSize, setDotSize] = useState(1)
  const screen = useScreen()
  const fps = useFps()

  return (
    <main className="flex size-screen pt-3">
      <div className="fixed top-2 left-2 text-xs font-mono opacity-70">{fps} fps · {backend} · dot {dotSize}</div>
      <Dotimation item={item} width={screen.width} height={screen.height - 48} backend={backend} dotSize={dotSize} />
      <div className="fixed bottom-2 inset-x-0 w-full flex flex-wrap items-center justify-center gap-1">
        {TEST_ITEMS.map(({ label, item: data }) => (
          <button key={label} type="button" onClick={() => setItem(data)} className={clsx('cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs', data === item && 'bg-primary/10')}>{label}</button>
        ))}
        {(['auto', 'canvas2d'] as BackendKind[]).map((b) => (
          <button key={b} type="button" onClick={() => setBackend(b)} className={clsx('cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs', backend === b && 'bg-primary/10')}>{b}</button>
        ))}
        <button type="button" onClick={() => setDotSize((d) => (d === 1 ? 2 : 1))} className="cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs">dotSize</button>
      </div>
    </main>
  )
}

export default App
```

- [ ] **Step 2: Manual verification checklist**

Run: `bun run dev`, open the playground. Confirm by eye:
- Each `TEST_ITEMS` preset renders dots forming the text/image (parity with `main`).
- Switching presets morphs smoothly (grow/shrink both look right).
- The FPS overlay drops to 0 repaints after ~1.5s of stillness (settle/sleep), and a preset switch wakes it.
- `dotSize` toggle visibly thickens the dots.
- Resizing the window re-rasterizes without crashing.

- [ ] **Step 3: Commit**

```bash
git add test/ui/src/app.tsx
git commit -m "test: playground controls (backend/dotSize) + FPS overlay"
```

---

## Task 17: Docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the stale README**

In `README.md`, delete the false line "Dotimation makes use of react-query so make sure this is used inside a QueryClientProvider" and document the new optional props (`dotSize`, `maxParticles`, `backend`, `idle`). Example block becomes:

```tsx
import { Dotimation } from 'dotimation'

function Component() {
  return (
    <Dotimation
      item={{ type: 'text', data: 'Hello' }}
      width={256}
      height={256}
      backend="auto"   // 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'
      idle="sleep"     // stop animating once settled
    />
  )
}
```

> Note: `maxParticles` is declared in types but not yet enforced in P0 — document it as "reserved / coming soon" or omit until P3. Pick omit for now to avoid documenting unimplemented behavior.

- [ ] **Step 2: Update CLAUDE.md architecture section**

In `CLAUDE.md`, replace the "Architecture: the particle pipeline" section so it describes: rasterize (`raster/`) → `FieldTargets`; `reconcile` into a single SoA `ParticleField`; the `Engine` orchestrator (timing/settle/visibility) driving a `Backend`; backends under `src/backends/` (Canvas2D shipped, WebGL2/WebGPU planned). Note the pure-core/DOM-shell split and that `bun test` covers the pure cores. Remove references to `animations/fps.ts`, `hooks/use-initial-particles.ts`, and `utils/utils.ts:initParticles`.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: fix stale react-query claim; document new engine + props"
```

---

## Definition of done (P0)

- `bun run type-check && bun run lint && bun test && bun run build` all green.
- Playground (Task 16) shows visual parity with `main`, smooth morphs, working settle/sleep, and `dotSize`.
- No remaining references to `Particle`, `initParticles`, `animateParticles`, or the two-buffer reconcile.
- Public API is a superset of the old one (existing props unchanged; `dotSize`/`backend`/`idle` added).

## Self-review notes (done while writing)

- **Spec coverage:** SoA model (T2), unified morph (T3), off-critical-path rasterization split (T4/T5), settle/sleep (T6/T13), Canvas2D micro-opts incl. hoisted endianness + dirty buffer + dotSize (T8/T9), backend contract + selection scaffold for P1/P2 (T10/T11), orchestrator (T12/T13), additive API (T15), tests for every pure core, README/CLAUDE fixes (T17). Worker rasterization + benchmark harness + `maxParticles` enforcement are intentionally deferred to P3 per the spec.
- **Type consistency:** `FieldTargets`/`ParticleField`/`Backend` defined once in T1 and used unchanged throughout; `reconcile(field, targets)`, `stepField(field, dt, k, c, rand?)`, `renderField(view, field, devW, devH, dpr, dotSize)`, `selectBackend({ requested, dotSize })`, `createEngine({ backend, canvas, dpr, idle })`, `accumulate(accumulator, frameDelta)` signatures match across tasks.
- **Deferred decisions:** color stored as `Float32` (resolved); `dotSize` = square device-px footprint on Canvas2D (resolved); worker rasterization → P3 (resolved).
