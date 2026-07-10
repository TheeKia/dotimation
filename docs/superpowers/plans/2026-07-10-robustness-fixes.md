# Dotimation Robustness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 16 findings from the 2026-07-10 robustness audit — one broken toolchain, eight correctness bugs, and seven smells/debt items — with unit tests for every piece of pure logic touched.

**Architecture:** The library keeps its strict pure-core / DOM-shell split. Fixes to pure logic (PRNG, reconcile, plan, sampler, worker-safe) are TDD'd under `bun test`. Fixes to DOM shells (component, hook, backends, worker client) are verified by type-check + lint + build and documented for playground verification. Two behavioral upgrades fall out of the fixes: live resize (engine survives size changes on every tier) and morph-from-home parity (all tiers morph identically).

**Tech Stack:** Bun toolchain only (`bun install/run/test`), TypeScript with `isolatedDeclarations` + `noUncheckedIndexedAccess`, Biome formatting (single quotes, no semicolons), React 19.

## Global Constraints

- Bun is the only toolchain; never invoke npm/yarn/pnpm.
- Every exported symbol needs an explicit return type (`isolatedDeclarations`).
- Indexed access needs `!` assertions (`noUncheckedIndexedAccess`); Biome's `noNonNullAssertion` is off — use them.
- Formatting is Biome-owned: run `bun run lint:fix` before each commit; the pre-commit hook runs `lint` + `type-check`.
- Match each file's import style (`@/*` in index.tsx, relative elsewhere) — follow the file being edited.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- After every task: `bun run type-check && bun run lint && bun test` must pass.

---

### Task 1: Repair the toolchain (audit #1)

The uncommitted `@biomejs/biome` bump to 2.5.3 mismatches `biome.json`'s 2.5.0 schema, so `bun run lint` (and therefore the pre-commit hook and CI) fails.

**Files:**
- Modify: `biome.json` (via `biome migrate`)
- Modify: `.claude/settings.local.json` (via `lint:fix`)
- Commit: `package.json`, `bun.lock` (the pending dep bumps)

- [ ] **Step 1: Migrate the Biome config**

Run: `cd /home/kia/code/dotimation && bunx biome migrate --write`
Expected: `biome.json` schema URL becomes `.../2.5.3/schema.json`.

- [ ] **Step 2: Autofix formatting**

Run: `bun run lint:fix`
Expected: `.claude/settings.local.json` reformatted; exit 0.

- [ ] **Step 3: Verify lint is green**

Run: `bun run lint && bun run type-check && bun test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock biome.json .claude/settings.local.json
git commit -m "chore: bump biome/webgpu-types and migrate biome config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared PRNG utility with a [0,1) contract (audit #6)

`fastRand()` is duplicated in `sample.ts` and `simulate.ts` and returns `rngState / 0xffffffff` — a **closed** [0,1] range (xorshift32 emits 0xffffffff). In `sampleTargets`'s partial Fisher–Yates, `rand() === 1` yields `j === n` → `order[n]` is `undefined` → NaN particle. Extract one PRNG util, divide by 2^32, test the boundary.

**Files:**
- Create: `src/utils/prng.ts`
- Test: `test/utils/prng.test.ts`
- Modify: `src/raster/sample.ts:3-13`, `src/backends/canvas2d/simulate.ts:4-15`

**Interfaces:**
- Produces: `xorshift32(state: number): number` (next 32-bit state), `toUnit(state: number): number` (maps to [0,1)), `createFastRand(seed: number): () => number` (seeded generator over both).

- [ ] **Step 1: Write the failing test** (`test/utils/prng.test.ts`)

```ts
import { describe, expect, test } from 'bun:test'
import { createFastRand, toUnit, xorshift32 } from '@/utils/prng'

describe('xorshift32', () => {
  test('never returns 0 from a nonzero state (full-period generator)', () => {
    let s = 1
    for (let i = 0; i < 10_000; i++) {
      s = xorshift32(s)
      expect(s).not.toBe(0)
    }
  })
  test('is deterministic', () => {
    expect(xorshift32(12345)).toBe(xorshift32(12345))
  })
})

describe('toUnit', () => {
  test('maps the maximum 32-bit state strictly below 1', () => {
    // Regression: dividing by 0xffffffff made rand() === 1 possible, which
    // pushed the Fisher–Yates pick in sampleTargets out of bounds (NaN dot).
    expect(toUnit(0xffffffff)).toBeLessThan(1)
    expect(toUnit(0xffffffff)).toBeGreaterThan(0.999)
  })
  test('maps the minimum nonzero state to (0, 1)', () => {
    expect(toUnit(1)).toBeGreaterThan(0)
    expect(toUnit(1)).toBeLessThan(1)
  })
})

describe('createFastRand', () => {
  test('same seed, same sequence; stays in [0, 1)', () => {
    const a = createFastRand(42)
    const b = createFastRand(42)
    for (let i = 0; i < 1000; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  test('a zero-ish seed still produces a live generator', () => {
    const r = createFastRand(0x9e3779b9) // seed ^ 0x9e3779b9 === 0 → fallback 1
    expect(r()).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun test test/utils/prng.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/utils/prng.ts`)

```ts
/**
 * Xorshift32 PRNG shared by the hot paths (pixel sampling, per-step jitter),
 * where Math.random's cost adds up. Split into a pure step + mapping so the
 * [0, 1) contract is unit-testable: the divisor must exceed the maximum state
 * or rand() can return exactly 1 (which broke sampleTargets' shuffle bound).
 */
export function xorshift32(state: number): number {
  let s = state
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}

/** Maps a 32-bit state onto [0, 1). 2^32 > max state, so 1 is unreachable. */
export function toUnit(state: number): number {
  return state / 0x100000000
}

/** Seeded generator in [0, 1). The sequence is cosmetic (jitter/shuffle). */
export function createFastRand(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1
  return () => {
    s = xorshift32(s)
    return toUnit(s)
  }
}
```

- [ ] **Step 4: Point both duplicates at it**

`src/raster/sample.ts` — replace lines 3-13 (the comment, `rngState`, and `fastRand`) with:

```ts
import { createFastRand } from '../utils/prng'

// Cheap seeded PRNG for the candidate shuffle — far cheaper than Math.random
// when sampling tens of thousands of pixels. `rand` stays injectable below so
// tests are deterministic.
const fastRand = createFastRand(Date.now())
```

`src/backends/canvas2d/simulate.ts` — replace lines 4-15 with:

```ts
import { createFastRand } from '../../utils/prng'

// Cheap seeded PRNG for the per-particle jitter. Called once per particle per
// step, so it sits squarely on the hot path where Math.random's cost adds up;
// the exact sequence is cosmetic (a horizontal shimmer only). `rand` stays
// injectable below so tests remain deterministic.
const fastRand = createFastRand(Date.now())
```

- [ ] **Step 5: Verify** — `bun run type-check && bun run lint:fix && bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/prng.ts test/utils/prng.test.ts src/raster/sample.ts src/backends/canvas2d/simulate.ts
git commit -m "fix: PRNG returned values in closed [0,1], breaking sampleTargets' shuffle bound

Extracts the duplicated xorshift32 into src/utils/prng.ts and divides by 2^32
so rand() can never hit exactly 1 (which indexed order[n] out of bounds and
produced a NaN particle).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the dead relocate/overlap plumbing (audit #10)

`planReconcile` returns `relocate: null` in all three branches, so the relocate branches in `field.ts`, `webgl2/index.ts`, and `webgpu/index.ts` (~70 lines of the trickiest buffer-copy code) are unreachable. `overlap` is only read inside those branches. Delete both from the plan and all consumers.

**Files:**
- Modify: `src/engine/reconcile-plan.ts` (drop `relocate` + `overlap` from `FieldDelta` and all returns)
- Modify: `src/engine/field.ts:103-107` (delete relocate branch)
- Modify: `src/backends/webgl2/index.ts:165-199` (delete relocate branch, drop unused `other`)
- Modify: `src/backends/webgpu/index.ts:138-167` (same)
- Modify: `src/backends/webgl2/program-sim.ts:128-134` (comment referenced the relocate path)
- Test: `test/engine/reconcile-plan.test.ts` (drop `relocate`/`overlap` from every expectation)

**Interfaces:**
- Produces: `FieldDelta` is now `{ active: number; count: number; spawn: { start: number; end: number } | null; firstLoad: boolean }`. Tasks 4, 9, 10 rely on this shape.

- [ ] **Step 1: Update the plan tests first** — in `test/engine/reconcile-plan.test.ts` delete the `overlap: N,` and `relocate: null,` lines from all seven `toEqual` objects (e.g. the first becomes `{ active: 3, count: 3, spawn: { start: 0, end: 3 }, firstLoad: true }`).

- [ ] **Step 2: Run to verify failure** — `bun test test/engine/reconcile-plan.test.ts` → FAIL (received objects still carry `overlap`/`relocate`).

- [ ] **Step 3: Shrink `FieldDelta`** — in `src/engine/reconcile-plan.ts` delete the `overlap` and `relocate` fields from the interface and from all three return objects; delete the two doc-comment sentences that mention relocation ("only the live cluster `[0, prevActive)` carries forward" stays, but "they are dropped (left outside `count`) rather than carried/relocated" becomes "they are dropped (left outside `count`)").

- [ ] **Step 4: Delete the dead consumers**
  - `src/engine/field.ts`: remove the `if (plan.relocate) {...}` block (lines 103-107).
  - `src/backends/webgl2/index.ts`: remove the `else if (plan.relocate) {...}` block; remove `const other = b.state[b.read ^ 1]!` (now unused).
  - `src/backends/webgpu/index.ts`: remove the `else if (plan.relocate) {...}` block; remove `const other = ...`.
  - `src/backends/webgl2/program-sim.ts`: in the comment at lines 128-134, replace the sentence beginning "uploadField's relocate path leaves BOTH ping-pong buffers bound" with "ensureCapacity leaves buffers bound to COPY_READ_BUFFER/COPY_WRITE_BUFFER, so clear those too — not just ARRAY_BUFFER left bound by uploadField/draw."

- [ ] **Step 5: Verify** — `bun run type-check && bun run lint:fix && bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/reconcile-plan.ts src/engine/field.ts src/backends/webgl2/index.ts src/backends/webgpu/index.ts src/backends/webgl2/program-sim.ts test/engine/reconcile-plan.test.ts
git commit -m "refactor: remove dead relocate/overlap plumbing from the reconcile plan

planReconcile has returned relocate: null in every branch since the
one-generation-of-faders change, leaving ~70 lines of unreachable GPU
copy code across all three backends.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Morph-from-home parity (audit #5)

Under GPU backends the CPU `fieldRef` is never simulated, so `f.x/f.y` are stale (last upload's values). But `reconcile` reads them: `collapseFaders` matches faders from `f.x[i]` and growth spawns via `copySlot(f, i % prevActive, i)`. Fix: derive both from **home** positions, which are authoritative on every tier and equal live positions on settled fields (the common case for transitions).

**Files:**
- Modify: `src/engine/field.ts` (spawn + collapseFaders)
- Test: `test/engine/reconcile.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `test/engine/reconcile.test.ts`:

```ts
describe('reconcile — GPU-tier parity (morph from home, not live position)', () => {
  test('growth spawns at the source slot pre-retarget home, not its live x/y', () => {
    let f = reconcile(
      createField(1),
      targets([
        [0, 0],
        [10, 10],
      ]),
    )
    // Simulate a GPU tier: the CPU x/y went stale (the sim runs on the GPU).
    f.x[0] = 12345
    f.y[0] = 12345
    f = reconcile(
      f,
      targets([
        [5, 5],
        [6, 6],
        [7, 7],
        [8, 8],
      ]),
    )
    // Slot 2 spawns from source slot 0: at its (old-layout) home (0,0), not
    // at the stale live position 12345.
    expect(f.x[2]).toBe(0)
    expect(f.y[2]).toBe(0)
    expect(f.alpha[2]).toBe(0)
    expect(f.homeX[2]).toBe(7) // retargeted to the new layout afterwards
  })

  test('shrink matches faders to survivors by home, not stale live position', () => {
    let f = reconcile(
      createField(1),
      coloredTargets([
        { x: 0, y: 0, r: 1 },
        { x: 100, y: 0, r: 2 }, // will become the fader
      ]),
    )
    // Stale live position near the LEFT survivor; home is near the RIGHT one.
    f.x[1] = 1
    f.y[1] = 0
    f = reconcile(
      f,
      coloredTargets([
        { x: 0, y: 0, r: 10 },
        { x: 90, y: 0, r: 20 },
      ]),
    )
    // Fader slot 2 held old home x=100 → nearest survivor by HOME is x=90.
    expect(f.active).toBe(2)
    expect(f.homeX[2]).toBe(90)
    expect(f.homeR[2]).toBe(20)
  })
})
```

Note: in the shrink test the old layout has 2 dots and the new has 2, so there is no shrink — fix the shape: old layout 3 dots `{x:0}, {x:50,r:1}, {x:100,r:2}`, new layout 2 dots `{x:0,r:10}, {x:90,r:20}`; fader is slot 2 (old home x=100, stale live x set to 1) and must collapse to x=90. Use that version verbatim:

```ts
  test('shrink matches faders to survivors by home, not stale live position', () => {
    let f = reconcile(
      createField(1),
      coloredTargets([
        { x: 0, y: 0, r: 1 },
        { x: 50, y: 0, r: 1 },
        { x: 100, y: 0, r: 2 }, // will become the fader
      ]),
    )
    f.x[2] = 1 // stale live position near the LEFT survivor
    f.y[2] = 0
    f = reconcile(
      f,
      coloredTargets([
        { x: 0, y: 0, r: 10 },
        { x: 90, y: 0, r: 20 },
      ]),
    )
    expect(f.active).toBe(2)
    expect(f.homeX[2]).toBe(90) // matched by old HOME (100), not stale x (1)
    expect(f.homeR[2]).toBe(20)
  })
```

- [ ] **Step 2: Run to verify failure** — `bun test test/engine/reconcile.test.ts` → the two new tests FAIL.

- [ ] **Step 3: Implement** — in `src/engine/field.ts`:

Spawn block becomes:

```ts
  if (plan.spawn) {
    const prevActive = field.active
    for (let i = plan.spawn.start; i < plan.spawn.end; i++) {
      if (prevActive > 0) {
        const src = i % prevActive
        copySlot(f, src, i)
        // Spawn at the source's HOME, not its live position: under GPU
        // backends the CPU field's x/y are stale (the sim runs on the GPU),
        // while homes are authoritative on every tier and equal the live
        // position once the field has settled.
        f.x[i] = f.homeX[src]!
        f.y[i] = f.homeY[src]!
        f.r[i] = f.homeR[src]!
        f.g[i] = f.homeG[src]!
        f.b[i] = f.homeB[src]!
      } else {
        f.x[i] = targets.homeX[i]!
        f.y[i] = targets.homeY[i]!
        f.r[i] = targets.homeR[i]!
        f.g[i] = targets.homeG[i]!
        f.b[i] = targets.homeB[i]!
      }
      f.vx[i] = 0
      f.vy[i] = 0
      f.alpha[i] = 0
    }
  }
```

`collapseFaders` loop body becomes (read home BEFORE overwriting it):

```ts
  for (let i = active; i < count; i++) {
    // Match from the fader's HOME (its slot in the outgoing layout), not its
    // live position: live x/y are stale under GPU backends, and on settled
    // fields home equals the live position anyway.
    const j = nearestTarget(grid, f.homeX[i]!, f.homeY[i]!)
    f.homeX[i] = targets.homeX[j]!
    f.homeY[i] = targets.homeY[j]!
    f.homeR[i] = targets.homeR[j]!
    f.homeG[i] = targets.homeG[j]!
    f.homeB[i] = targets.homeB[j]!
    f.targetAlpha[i] = 0
  }
```

- [ ] **Step 4: Verify** — `bun test` → all pass (existing collapse tests already operate on settled fields where home === position, so they stay green).

- [ ] **Step 5: Commit**

```bash
git add src/engine/field.ts test/engine/reconcile.test.ts
git commit -m "fix: morph from home positions so GPU tiers spawn/collapse correctly

Under webgl2/webgpu the CPU field is never simulated, so its x/y are a
whole layout out of date; spawning and fader-matching from them made dots
fly in from (and collapse toward) the wrong places on GPU tiers only.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: useFieldTargets — track every input, clear on empty, retry after failure (audit #2, #3)

The ref-gate early-returns unless `item`/size changed, so runtime changes to `alpha`, `pointSpacingCss`, `maxParticles`, `defaultFontFamily` are silently ignored. `if (!item.data) return` makes the canvas impossible to clear. `prevItem` updates before the async work resolves, so a failed rasterization can never be retried. Extract the input comparison as a pure, tested function; take a `dprEpoch` param (wired by Task 8).

**Files:**
- Create: `src/raster/inputs.ts`
- Test: `test/raster/inputs.test.ts`
- Modify: `src/raster/sample.ts` (add `emptyFieldTargets`), `src/raster/rasterize.ts` (reuse it), `src/hooks/use-field-targets.ts` (rewrite), `src/components/dotimation.tsx` (pass `dprEpoch: 0` until Task 8 wires the real one)

**Interfaces:**
- Produces: `RasterInputs` interface `{ item, width, height, defaultFontFamily, alpha, pointSpacingCss, maxParticles, dprEpoch }`; `sameRasterInputs(a: RasterInputs, b: RasterInputs): boolean`; `emptyFieldTargets(): FieldTargets`; `useFieldTargets` gains a trailing `dprEpoch: number` parameter.

- [ ] **Step 1: Write the failing tests** (`test/raster/inputs.test.ts`)

```ts
import { describe, expect, test } from 'bun:test'
import { type RasterInputs, sameRasterInputs } from '@/raster/inputs'
import type { AnimateItem } from '@/types'

const base = (over: Partial<RasterInputs> = {}): RasterInputs => ({
  item: { type: 'text', data: 'hi' } as AnimateItem,
  width: 100,
  height: 50,
  defaultFontFamily: 'sans-serif',
  alpha: 128,
  pointSpacingCss: 2,
  maxParticles: Number.POSITIVE_INFINITY,
  dprEpoch: 0,
  ...over,
})

describe('sameRasterInputs', () => {
  test('equal inputs (fresh but shallow-equal item objects) compare equal', () => {
    expect(sameRasterInputs(base(), base())).toBe(true)
  })
  test('item content change is detected', () => {
    expect(
      sameRasterInputs(base(), base({ item: { type: 'text', data: 'yo' } })),
    ).toBe(false)
  })
  test.each([
    ['width', { width: 101 }],
    ['height', { height: 51 }],
    ['defaultFontFamily', { defaultFontFamily: 'serif' }],
    ['alpha', { alpha: 64 }],
    ['pointSpacingCss', { pointSpacingCss: 3 }],
    ['maxParticles', { maxParticles: 500 }],
    ['dprEpoch', { dprEpoch: 1 }],
  ] as const)('%s change is detected (regression: was ignored)', (_n, over) => {
    expect(sameRasterInputs(base(), base(over))).toBe(false)
  })
})
```

And append to `test/raster/sample.test.ts`:

```ts
describe('emptyFieldTargets', () => {
  test('returns a zero-count layout with empty arrays', () => {
    const t = emptyFieldTargets()
    expect(t.count).toBe(0)
    expect(t.homeX.length).toBe(0)
  })
})
```

(add `emptyFieldTargets` to that file's import from `@/raster/sample`).

- [ ] **Step 2: Run to verify failure** — `bun test test/raster` → FAIL.

- [ ] **Step 3: Implement the pure pieces**

`src/raster/inputs.ts`:

```ts
import type { AnimateItem } from '../types'

/**
 * Everything that affects rasterization output. `useFieldTargets` re-runs the
 * rasterizer exactly when one of these changed — comparing ALL of them here
 * (pure, unit-tested) is the fix for silently ignoring runtime changes to
 * alpha/pointSpacingCss/maxParticles/defaultFontFamily.
 */
export interface RasterInputs {
  item: AnimateItem
  width: number
  height: number
  defaultFontFamily: string
  alpha: number
  pointSpacingCss: number
  maxParticles: number
  /** Bumped by the component when devicePixelRatio changes (see Dotimation). */
  dprEpoch: number
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

export function sameRasterInputs(a: RasterInputs, b: RasterInputs): boolean {
  return (
    shallowEqual(a.item, b.item) &&
    a.width === b.width &&
    a.height === b.height &&
    a.defaultFontFamily === b.defaultFontFamily &&
    a.alpha === b.alpha &&
    a.pointSpacingCss === b.pointSpacingCss &&
    a.maxParticles === b.maxParticles &&
    a.dprEpoch === b.dprEpoch
  )
}
```

`src/raster/sample.ts` — add:

```ts
/** The zero-particle layout: what an empty item rasterizes to. */
export function emptyFieldTargets(): FieldTargets {
  return {
    count: 0,
    homeX: new Float32Array(0),
    homeY: new Float32Array(0),
    homeR: new Float32Array(0),
    homeG: new Float32Array(0),
    homeB: new Float32Array(0),
  }
}
```

`src/raster/rasterize.ts` — replace the inline `empty` literal with `const empty = emptyFieldTargets()` (import from `./sample`).

- [ ] **Step 4: Rewrite the hook** (`src/hooks/use-field-targets.ts`, full file)

```ts
import { useEffect, useRef, useState } from 'react'
import { type RasterInputs, sameRasterInputs } from '@/raster/inputs'
import { rasterize } from '@/raster/rasterize'
import {
  rasterizeViaWorker,
  workerRasterAvailable,
} from '@/raster/rasterize-worker'
import { emptyFieldTargets } from '@/raster/sample'
import { isWorkerSafe } from '@/raster/worker-safe'
import type { AnimateItem, FieldTargets } from '@/types'

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
  dprEpoch: number,
): FieldTargets | null {
  const [targets, setTargets] = useState<FieldTargets | null>(null)
  const prev = useRef<RasterInputs | null>(null)
  const executionId = useRef(0)

  useEffect(() => {
    const next: RasterInputs = {
      item,
      width,
      height,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
      maxParticles,
      dprEpoch,
    }
    if (prev.current && sameRasterInputs(prev.current, next)) return
    prev.current = next
    const id = ++executionId.current

    // An empty item is a valid layout (zero particles): publish it so the
    // field fades out instead of freezing the previous content forever.
    if (!item.data) {
      setTargets(emptyFieldTargets())
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const useWorker =
      workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)
    const task = useWorker
      ? rasterizeViaWorker(
          width,
          height,
          item,
          defaultFontFamily,
          alpha,
          pointSpacingCss,
          maxParticles,
          dpr,
        ).catch(() =>
          rasterize(
            width,
            height,
            item,
            defaultFontFamily,
            alpha,
            pointSpacingCss,
            maxParticles,
          ),
        )
      : rasterize(
          width,
          height,
          item,
          defaultFontFamily,
          alpha,
          pointSpacingCss,
          maxParticles,
        )
    task
      .then((t) => {
        if (id === executionId.current) setTargets(t)
      })
      .catch((err) => {
        // Rasterization can reject (e.g. a cross-origin image fails to load or
        // the canvas is tainted). Keep the previously rendered targets, but
        // forget these inputs so a later render can retry them.
        if (id === executionId.current && prev.current === next) {
          prev.current = null
        }
        if (typeof console !== 'undefined') {
          console.warn('[dotimation] rasterization failed', err)
        }
      })
  }, [
    width,
    height,
    item,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
    dprEpoch,
  ])

  return targets
}
```

- [ ] **Step 5: Pass the new param** — in `src/components/dotimation.tsx`, change the `useFieldTargets(...)` call to append `0` as the eighth argument with a `// dprEpoch — wired in the resize/DPR task` comment (Task 8 replaces it).

- [ ] **Step 6: Verify** — `bun run type-check && bun run lint:fix && bun test` → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/raster/inputs.ts test/raster/inputs.test.ts src/raster/sample.ts test/raster/sample.test.ts src/raster/rasterize.ts src/hooks/use-field-targets.ts src/components/dotimation.tsx
git commit -m "fix: re-rasterize on every input change, clear on empty items, retry after failure

- alpha/pointSpacingCss/maxParticles/defaultFontFamily changes were silently
  ignored (the ref-gate only compared item and size)
- empty item.data now publishes a zero-particle layout so the field fades out
  instead of freezing the old content forever
- prev-inputs are forgotten when rasterization rejects, so the same inputs can
  be retried instead of being permanently swallowed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Backend cascade must surface total failure (audit #4)

If a GPU backend acquires its context type and then throws mid-init, the canvas is bound to that context type forever; canvas2d's `getContext('2d')` returns null and the backend silently no-ops. Make canvas2d `init` throw, remove `selectBackend`'s (now-throwing) trailing duplicate, and catch in the component with a console error.

**Files:**
- Modify: `src/backends/canvas2d/index.ts:38-45`
- Modify: `src/engine/select.ts:59-62`
- Modify: `src/components/dotimation.tsx` (wrap `selectBackend` in try/catch)

- [ ] **Step 1: canvas2d init throws on a null context**

```ts
    init(canvas, devicePixelRatio): void {
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      // Throws instead of silently rendering nothing: getContext('2d') returns
      // null when the canvas is already bound to another context type (a GPU
      // tier acquired it, then failed mid-init).
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas2d: 2d context unavailable')
      ctx = context
      ctx.imageSmoothingEnabled = false
      ensureBuffer()
    },
```

- [ ] **Step 2: selectBackend throws after exhausting tiers** — replace lines 60-62 of `src/engine/select.ts` with:

```ts
  // Every tier failed — including Canvas2D, which only happens when the canvas
  // is already bound to a different context type. Surface it; a silent blank
  // canvas is undebuggable.
  throw new Error('dotimation: no rendering backend could initialize')
```

Also update the function docblock's last sentence from "Canvas2D is the always-present last tier and is assumed not to throw." to "Canvas2D is the always-present last tier; if even it fails (canvas already bound to another context type), this throws rather than returning a dead backend."

- [ ] **Step 3: Component catches** — in the creation effect's async IIFE:

```ts
      let selected: { backend: Backend; kind: ConcreteBackend }
      try {
        selected = await selectBackend({
          requested: backend,
          dotSize: dotSizeRef.current,
          canvas,
          dpr,
        })
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error('[dotimation] no rendering backend could initialize', err)
        }
        return
      }
      if (cancelled) {
        selected.backend.dispose()
        return
      }
```

(import `type Backend` from `@/types` and `type ConcreteBackend` from `@/engine/cascade`; adjust the rest of the IIFE to use `selected.backend`/`selected.kind`.)

- [ ] **Step 4: Verify** — `bun run type-check && bun run lint:fix && bun test` → pass. Manual: playground still renders (`bun run dev`, canvas2d/webgl2/webgpu toggles).

- [ ] **Step 5: Commit**

```bash
git add src/backends/canvas2d/index.ts src/engine/select.ts src/components/dotimation.tsx
git commit -m "fix: surface backend-cascade failure instead of a silent dead canvas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: dotSize race during backend selection (audit #9)

A `dotSize` change while `selectBackend` is awaiting hits `engineRef.current === null` and is lost; the backend keeps the construct-time value.

**Files:**
- Modify: `src/components/dotimation.tsx` (creation effect)

- [ ] **Step 1: Capture and re-sync** — in the creation effect:

```ts
    const constructedDotSize = dotSizeRef.current
```
before the `selectBackend` call (and pass `dotSize: constructedDotSize`), then after `engineRef.current = engine`:

```ts
      // dotSize may have changed while the backend was initializing; the
      // setDotSize effect ran against a null engineRef and was dropped.
      if (dotSizeRef.current !== constructedDotSize) {
        engine.setDotSize(dotSizeRef.current)
      }
```

- [ ] **Step 2: Verify + commit**

```bash
bun run type-check && bun run lint:fix && bun test
git add src/components/dotimation.tsx
git commit -m "fix: apply dotSize changes that land during async backend selection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Live resize + DPR-change handling (audit #12, #15-resize)

The component tears the engine down on every `width`/`height` change, resetting all particles — while every backend already implements `resize()` and `engine.resize` sits unused ("wired for P1/P2" per its own docblock). And `dpr` is frozen at creation, so browser zoom / monitor moves render blurry. Fix both: size changes resize in place; DPR changes bump an epoch that recreates the engine (fresh canvas via key) and re-rasterizes.

**Files:**
- Modify: `src/components/dotimation.tsx` (full rewrite below)
- Modify: `src/engine/engine.ts:19-24` (docblock now true)

- [ ] **Step 1: Rewrite the component** — `src/components/dotimation.tsx` becomes:

```tsx
'use client'

import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ConcreteBackend } from '@/engine/cascade'
import { createEngine, type Engine } from '@/engine/engine'
import { createField, reconcile } from '@/engine/field'
import { selectBackend } from '@/engine/select'
import { useFieldTargets } from '@/hooks/use-field-targets'
import type {
  AnimateItem,
  Backend,
  BackendKind,
  DotimationStats,
  FieldTargets,
  IdleBehavior,
  ParticleField,
} from '@/types'
import { sizeCanvas } from '@/utils/utils'

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
  /** @default unbounded */
  maxParticles?: number
  onStats?: (stats: DotimationStats) => void
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
  maxParticles = Number.POSITIVE_INFINITY,
  onStats,
}: DotimationProps): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const fieldRef = useRef<ParticleField>(createField(1024))
  const targetsRef = useRef<FieldTargets | null>(null)
  const kindRef = useRef<DotimationStats['backend']>('canvas2d')
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  // dotSize is read at draw time, so it can update live without recreating the
  // engine. The creation effect reads it through this ref to avoid listing it
  // as a dependency (which would tear down the engine and reset the field).
  const dotSizeRef = useRef(dotSize)
  dotSizeRef.current = dotSize
  // Latest size, readable by the creation effect without being a dependency —
  // size changes are applied live via engine.resize, never by recreation.
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  // Bumped when devicePixelRatio changes (zoom, monitor move) so the engine
  // and rasterization re-key at the new density instead of rendering blurry.
  const [dprEpoch, setDprEpoch] = useState(0)

  useImperativeHandle(canvasRef, () => ref.current!)

  const targets = useFieldTargets(
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
    dprEpoch,
  )

  // Watch for devicePixelRatio changes. The media query matches only the
  // current ratio, so it must be re-armed after every change (hence dprEpoch
  // in the deps).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onChange = (): void => setDprEpoch((e) => e + 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dprEpoch])

  // Create / recreate the engine when the backend config or device pixel
  // ratio changes. Size changes do NOT recreate it (see the resize effect).
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    let engine: Engine | null = null

    const dpr = sizeCanvas(canvas, sizeRef.current.width, sizeRef.current.height)

    void (async () => {
      const constructedDotSize = dotSizeRef.current
      let selected: { backend: Backend; kind: ConcreteBackend }
      try {
        selected = await selectBackend({
          requested: backend,
          dotSize: constructedDotSize,
          canvas,
          dpr,
        })
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error(
            '[dotimation] no rendering backend could initialize',
            err,
          )
        }
        return
      }
      if (cancelled) {
        selected.backend.dispose()
        return
      }
      kindRef.current = selected.kind
      engine = createEngine({ backend: selected.backend, canvas, dpr, idle })
      engineRef.current = engine
      // dotSize may have changed while the backend was initializing; the
      // setDotSize effect ran against a null engineRef and was dropped.
      if (dotSizeRef.current !== constructedDotSize) {
        engine.setDotSize(dotSizeRef.current)
      }
      // So may the size; the resize effect was likewise dropped.
      const { width: w, height: h } = sizeRef.current
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        sizeCanvas(canvas, w, h)
        engine.resize(canvas.width, canvas.height)
      }
      fieldRef.current = createField(1024)
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        engine.setField(fieldRef.current)
      }
      onStatsRef.current?.({
        backend: selected.kind,
        particles: fieldRef.current.active,
      })
    })()

    return () => {
      cancelled = true
      engine?.dispose()
      engineRef.current = null
    }
  }, [backend, idle, dprEpoch])

  // Live resize: retune the backing store and notify the engine in place, so
  // simulation state survives (the morph continues instead of restarting).
  useEffect(() => {
    const canvas = ref.current
    const engine = engineRef.current
    if (!canvas || !engine) return
    sizeCanvas(canvas, width, height)
    engine.resize(canvas.width, canvas.height)
  }, [width, height])

  // dotSize only affects draw-time rendering, so push it to the live backend
  // instead of recreating the engine (which would reset every particle).
  useEffect(() => {
    engineRef.current?.setDotSize(dotSize)
  }, [dotSize])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    engineRef.current.setField(fieldRef.current)
    onStatsRef.current?.({
      backend: kindRef.current,
      particles: fieldRef.current.active,
    })
  }, [targets])

  return (
    // A canvas can only ever hold one context type ('2d' | 'webgl2' | 'webgpu')
    // for its lifetime, and a lost/disposed context cannot be reacquired on the
    // same canvas. Keying on backend + dprEpoch remounts a fresh canvas whenever
    // the engine is recreated, so each incarnation gets a clean slate.
    <canvas
      key={`${backend}:${dprEpoch}`}
      ref={ref}
      className={className}
      width={width}
      height={height}
      style={style}
    />
  )
}
```

- [ ] **Step 2: Fix the engine docblock** — `src/engine/engine.ts` `resize` comment becomes:

```ts
  /**
   * Resize in place without tearing down the engine — the component calls this
   * on width/height changes so simulation state survives across resizes.
   */
```

- [ ] **Step 3: Verify** — `bun run type-check && bun run lint:fix && bun test` → pass. Manual (playground): resize the demo pane — dots must morph to the new layout without a full fade-in restart, on all three backends.

- [ ] **Step 4: Commit**

```bash
git add src/components/dotimation.tsx src/engine/engine.ts
git commit -m "feat: live resize and devicePixelRatio-change handling

Size changes now call engine.resize (all backends already implemented it)
instead of tearing the engine down, so particles morph across resizes
instead of restarting. devicePixelRatio changes (zoom/monitor move) bump an
epoch that re-keys the canvas, engine, and rasterization at the new density.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: WebGPU per-step jitter seeds (audit #7)

`simU[6]` (seed) is written once per frame but all batched compute passes read the same uniform, so multi-step frames apply the identical jitter N times in one direction — amplified shimmer vs. canvas2d/webgl2. Fix with per-step uniform slices + dynamic offsets.

**Files:**
- Modify: `src/backends/webgpu/pipelines.ts` (explicit sim bind-group layout with `hasDynamicOffset`, sliced uniform buffer, expose `simUniformStride`)
- Modify: `src/backends/webgpu/index.ts` (write one slice per step, bind with dynamic offset)

**Interfaces:**
- Produces: `Pipelines` gains `simUniformStride: number`; `simBindGroup` binds `simUniform` at offset 0 with `size: 32` and dynamic offset enabled.

- [ ] **Step 1: pipelines.ts** — add imports and replace the compute pipeline + uniform creation:

```ts
import { MAX_STEPS_PER_FRAME } from '@/engine/clock'
```

```ts
const SIM_U_BYTES = 8 * 4

export interface Pipelines {
  compute: GPUComputePipeline
  render: GPURenderPipeline
  simUniform: GPUBuffer
  /** Byte stride between per-step slices of simUniform (alignment-padded). */
  simUniformStride: number
  renderUniform: GPUBuffer
  simBindGroup(
    inState: GPUBuffer,
    outState: GPUBuffer,
    targets: GPUBuffer,
  ): GPUBindGroup
  renderBindGroup(): GPUBindGroup
  device: GPUDevice
}
```

In `createPipelines`, replace the `compute` pipeline and `simUniform` creation with:

```ts
  // The sim uniform holds one slice PER physics step of the frame, bound via
  // dynamic offset, so each batched compute pass gets its own jitter seed —
  // reusing one seed across passes applies identical jitter N times in the
  // same direction (amplified shimmer vs. the other tiers).
  const simUniformStride = Math.max(
    device.limits.minUniformBufferOffsetAlignment,
    SIM_U_BYTES,
  )
  const simLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
          hasDynamicOffset: true,
          minBindingSize: SIM_U_BYTES,
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
    ],
  })
  const compute = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
    compute: { module: simModule, entryPoint: 'main' },
  })
```

```ts
  const simUniform = device.createBuffer({
    size: simUniformStride * MAX_STEPS_PER_FRAME,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
```

`simBindGroup`'s binding 0 entry becomes:

```ts
          {
            binding: 0,
            resource: { buffer: simUniform, offset: 0, size: SIM_U_BYTES },
          },
```

(and use `layout: simLayout` instead of `compute.getBindGroupLayout(0)`; return `simUniformStride` in the object).

- [ ] **Step 2: index.ts draw()** — import `MAX_STEPS_PER_FRAME` alongside `FIXED_DT`; replace the sim-uniform write and compute loop:

```ts
      const b = buffers
      const steps = Math.min(pendingSteps, MAX_STEPS_PER_FRAME)
      pendingSteps = 0

      if (steps > 0 && count > 0 && simBindGroups) {
        simU[0] = stepDt
        simU[1] = k
        simU[2] = c
        simU[3] = COLOR_RATE
        simU[4] = OPACITY_RATE
        simU[5] = JITTER_AMOUNT
        simU[7] = count
        // One slice per step, each with a fresh jitter seed (matching the
        // other tiers' per-step reseed); the passes select their slice via
        // dynamic offset since all writeBuffers land before the one submit.
        for (let s = 0; s < steps; s++) {
          simU[6] = Math.random() * 1000
          device.queue.writeBuffer(
            pipelines.simUniform,
            s * pipelines.simUniformStride,
            simU,
          )
        }
      }
```

and in the compute loop:

```ts
        let r = b.read
        for (let s = 0; s < steps; s++) {
          const sim = enc.beginComputePass()
          sim.setPipeline(pipelines.compute)
          sim.setBindGroup(0, simBindGroups[r], [s * pipelines.simUniformStride])
          sim.dispatchWorkgroups(Math.ceil(count / 64))
          sim.end()
          r ^= 1
        }
        b.read = r as 0 | 1
```

- [ ] **Step 3: Verify** — `bun run type-check && bun run lint:fix && bun test` → pass. Manual: playground on a WebGPU browser — shimmer amplitude comparable to canvas2d.

- [ ] **Step 4: Commit**

```bash
git add src/backends/webgpu/pipelines.ts src/backends/webgpu/index.ts
git commit -m "fix(webgpu): fresh jitter seed per batched physics step via dynamic uniform offsets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: WebGPU device-loss recovery + redraw-after-restore (audit #8)

`device.lost` permanently blanks the canvas (`lost = true`, no recovery), unlike webgl2's restore path. Re-acquire the device, rebuild resources, re-upload the last field, and draw once. Give webgl2's restore the same final draw so a sleeping engine isn't blank until the next wake.

**Files:**
- Modify: `src/backends/webgpu/index.ts` (extract `setup()`, add `canvasEl`/`lastField`/`disposed`, recovery path)
- Modify: `src/backends/webgl2/index.ts:59-70` (`onRestored` ends with `api.draw()`)

- [ ] **Step 1: webgpu restructure** — in `createWebGPUBackend`:

Add state:

```ts
  let canvasEl: HTMLCanvasElement | null = null
  let lastField: ParticleField | null = null
  let disposed = false
```

Add above `rebuildBindGroups`:

```ts
  async function setup(canvas: HTMLCanvasElement): Promise<void> {
    const s = await acquireGPU(canvas)
    device = s.device
    context = s.context
    pipelines = createPipelines(device, s.format)
    buffers = createBuffers(device, 1024)
    rebuildBindGroups()
    watchLoss(s.device)
  }

  function watchLoss(d: GPUDevice): void {
    void d.lost.then((info) => {
      if (disposed || device !== d) return
      lost = true
      // 'destroyed' is our own dispose(); anything else (GPU reset, driver
      // update, OS sleep) is recoverable by re-acquiring a device.
      if (info.reason === 'destroyed') return
      void recover()
    })
  }

  async function recover(): Promise<void> {
    if (!canvasEl || disposed) return
    try {
      active = 0
      count = 0
      pendingSteps = 0
      renderUniformDirty = true
      await setup(canvasEl)
      lost = false
      // Re-seed from the last field and paint once, so the canvas isn't blank
      // until the engine happens to wake.
      if (lastField) {
        api.uploadField(lastField)
        api.draw()
      }
    } catch {
      // A second failure means the GPU is really gone; stay lost.
    }
  }
```

Change the returned object literal to `const api: Backend = { ... }` with `return api` at the end (mirroring webgl2). `init` becomes:

```ts
    async init(canvas, devicePixelRatio): Promise<void> {
      canvasEl = canvas
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      await setup(canvas)
    },
```

`uploadField` records the field first and skips GPU writes while lost:

```ts
    uploadField(field: ParticleField): void {
      lastField = field
      if (!device || !buffers || lost) return
      ...
```

- [ ] **Step 2: webgl2 draw-after-restore** — `onRestored` gains a final draw:

```ts
    if (lastField) {
      api.uploadField(lastField)
      api.draw()
    }
```

- [ ] **Step 3: Verify** — `bun run type-check && bun run lint:fix && bun test` → pass.

- [ ] **Step 4: Commit**

```bash
git add src/backends/webgpu/index.ts src/backends/webgl2/index.ts
git commit -m "fix(webgpu): recover from device loss instead of blanking forever

Re-acquires a device, rebuilds pipelines/buffers, re-uploads the last field
and paints once. webgl2's context-restore now also paints immediately.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Resource lifetimes — GL context release, GPU device destroy, worker idle shutdown + hang-proofing (audit #11, #14a)

webgl2 never releases its context (browsers cap live contexts); webgpu never destroys its device (StrictMode leaks one per mount); the raster worker singleton lives forever, has no `messageerror` handler, and a request that never gets a reply hangs its promise forever.

**Files:**
- Modify: `src/backends/webgl2/index.ts` (dispose)
- Modify: `src/backends/webgpu/index.ts` (dispose)
- Modify: `src/raster/rasterize-worker.ts` (full rewrite)

- [ ] **Step 1: webgl2 dispose releases the context when the canvas is gone**

```ts
    dispose(): void {
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', onLost)
        canvasEl.removeEventListener('webglcontextrestored', onRestored)
      }
      if (gl && buffers) disposeBuffers(gl, buffers)
      sim?.dispose()
      draw?.dispose()
      // Browsers cap live WebGL contexts and a GC'd canvas does not promptly
      // free its context, so release it proactively — but only when the canvas
      // left the DOM. While it is still connected (StrictMode remount, engine
      // recreation) the next backend reuses this same context, and losing it
      // here would brick that successor.
      if (gl && canvasEl && !canvasEl.isConnected && !gl.isContextLost()) {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
      gl = null
      canvasEl = null
      buffers = null
      sim = null
      draw = null
    },
```

- [ ] **Step 2: webgpu dispose destroys the device**

```ts
    dispose(): void {
      disposed = true
      if (buffers) disposeBuffers(buffers)
      pipelines?.simUniform.destroy()
      pipelines?.renderUniform.destroy()
      // Frees the GPU device deterministically (GC is not prompt about it);
      // triggers device.lost with reason 'destroyed', which watchLoss ignores.
      device?.destroy()
      device = null
      context = null
      pipelines = null
      buffers = null
      simBindGroups = null
      renderBind = null
      canvasEl = null
      lastField = null
    },
```

- [ ] **Step 3: Rewrite the worker client** — `src/raster/rasterize-worker.ts` becomes:

```ts
import type { AnimateItem, FieldTargets } from '@/types'
import { WORKER_SOURCE } from './worker-source'

interface Pending {
  resolve: (t: FieldTargets) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// A stuck worker (or a message that never gets a reply) must reject rather
// than hang the caller's promise forever — the caller falls back to the
// main-thread rasterizer on rejection.
const REQUEST_TIMEOUT_MS = 15_000
// The worker is torn down after sitting idle so it doesn't hold a thread for
// the page's lifetime; the next request just spins up a fresh one.
const IDLE_TIMEOUT_MS = 10_000

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let idleTimer: ReturnType<typeof setTimeout> | null = null

function disarmIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function armIdleTimer(): void {
  disarmIdleTimer()
  if (!worker || pending.size > 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    worker?.terminate()
    worker = null
  }, IDLE_TIMEOUT_MS)
}

/** Removes and returns the pending entry, clearing its timeout. */
function take(id: number): Pending | undefined {
  const p = pending.get(id)
  if (p) {
    pending.delete(id)
    clearTimeout(p.timer)
  }
  return p
}

function failAll(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  pending.clear()
  disarmIdleTimer()
  worker?.terminate()
  worker = null
}

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    // The worker is bundled to a self-contained string at build time and
    // instantiated from a Blob URL, so it ships inlined in the library and
    // works in any consumer regardless of their bundler's worker handling.
    const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
    )
    worker = new Worker(url, { type: 'module' })
    // The worker has its own reference to the resource now, so the object URL
    // can be released immediately instead of leaking for the page's lifetime.
    URL.revokeObjectURL(url)
    worker.onmessage = (e: MessageEvent): void => {
      const { id, targets, error } = e.data as {
        id: number
        targets?: FieldTargets
        error?: string
      }
      const p = take(id)
      if (!p) return
      if (error || !targets)
        p.reject(new Error(error ?? 'worker: empty result'))
      else p.resolve(targets)
      armIdleTimer()
    }
    worker.onerror = (): void => failAll(new Error('worker: error'))
    // A reply that fails to deserialize carries no id, so every in-flight
    // request must be failed over to the main-thread fallback.
    worker.onmessageerror = (): void => failAll(new Error('worker: message deserialization failed'))
  } catch {
    worker = null
  }
  return worker
}

/** True only where a module worker + OffscreenCanvas exist. */
export function workerRasterAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

export function rasterizeViaWorker(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
  dpr: number,
): Promise<FieldTargets> {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('worker: unavailable'))
  disarmIdleTimer()
  const id = nextId++
  return new Promise<FieldTargets>((resolve, reject) => {
    const timer = setTimeout(() => {
      take(id)?.reject(new Error('worker: timed out'))
      armIdleTimer()
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    w.postMessage({
      id,
      item,
      width,
      height,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
      maxParticles,
      dpr,
    })
  })
}
```

- [ ] **Step 4: Verify** — `bun run type-check && bun run lint:fix && bun test` → pass. Manual: playground text demo still renders via worker; leave idle 10 s and change text — a fresh worker spins up.

- [ ] **Step 5: Commit**

```bash
git add src/backends/webgl2/index.ts src/backends/webgpu/index.ts src/raster/rasterize-worker.ts
git commit -m "fix: deterministic resource lifetimes for GL context, GPU device, and raster worker

- webgl2 dispose releases its context via WEBGL_lose_context once the canvas
  left the DOM (browsers cap live contexts; GC is not prompt)
- webgpu dispose destroys its device (StrictMode leaked one per mount)
- the raster worker terminates after 10s idle, rejects requests after 15s,
  and handles messageerror so no caller promise can hang forever

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: isWorkerSafe screens non-cloneable textColor (audit #14b)

A `CanvasGradient`/`CanvasPattern` textColor throws `DataCloneError` in `postMessage`; the fallback catches it, but the worker round-trip attempt is wasted and the gradient could never render in a worker anyway (it is bound to a main-thread context).

**Files:**
- Modify: `src/raster/worker-safe.ts`
- Test: `test/raster/worker-safe.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the describe block:

```ts
  test('gradient/pattern textColor is NOT worker-safe (not structured-cloneable)', () => {
    const gradient = { addColorStop() {} } as unknown as CanvasGradient
    const withGradient: AnimateItem = {
      type: 'text',
      data: 'hi',
      textColor: gradient,
    }
    expect(isWorkerSafe(withGradient, 'sans-serif')).toBe(false)
    const withString: AnimateItem = {
      type: 'text',
      data: 'hi',
      textColor: '#fff',
    }
    expect(isWorkerSafe(withString, 'sans-serif')).toBe(true)
  })
```

- [ ] **Step 2: Run to verify failure** — `bun test test/raster/worker-safe.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `src/raster/worker-safe.ts`, after the image early-return:

```ts
  // Gradient/pattern fills are bound to a main-thread context and are not
  // structured-cloneable — postMessage would throw DataCloneError.
  if (item.textColor !== undefined && typeof item.textColor !== 'string') {
    return false
  }
```

Also extend the docblock: "Text can only when its resolved family is a CSS generic … and its fill is a plain color string."

- [ ] **Step 4: Verify + commit**

```bash
bun test && bun run type-check && bun run lint:fix
git add src/raster/worker-safe.ts test/raster/worker-safe.test.ts
git commit -m "fix: keep gradient/pattern text fills off the worker path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Deterministic image inversion (audit #13)

`ctx.filter = 'invert(1)'` is silently ignored where unsupported (historically Safari, especially OffscreenCanvas in workers) — `invert: true` becomes a no-op with no signal. Since both rasterizers already call `getImageData`, invert the pixels directly: identical output (`255 - c` per channel), zero browser variance.

**Files:**
- Modify: `src/raster/sample.ts` (add `invertPixels`), `src/raster/draw.ts` (drop the filter branch), `src/raster/rasterize.ts`, `src/raster/raster.worker.ts`
- Test: `test/raster/sample.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/raster/sample.test.ts` (add `invertPixels` to the import):

```ts
describe('invertPixels', () => {
  test('inverts RGB in place and preserves alpha', () => {
    const px = new Uint8ClampedArray([0, 128, 255, 200, 10, 20, 30, 0])
    invertPixels(px)
    expect([...px]).toEqual([255, 127, 0, 200, 245, 235, 225, 0])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun test test/raster/sample.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/raster/sample.ts`:

```ts
/**
 * In-place RGB inversion (alpha untouched). Replaces ctx.filter = 'invert(1)',
 * which is silently ignored where unsupported (notably OffscreenCanvas in some
 * Safari versions) — the pixel walk is deterministic everywhere and the
 * buffer is already in hand for sampling.
 */
export function invertPixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i]!
    pixels[i + 1] = 255 - pixels[i + 1]!
    pixels[i + 2] = 255 - pixels[i + 2]!
  }
}
```

`src/raster/draw.ts` — `drawImage` loses the filter branch:

```ts
export function drawImage(
  ctx: Ctx2D,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  width: number,
  height: number,
  item: Extract<AnimateItem, { type: 'image' }>,
): void {
  const scale = imageScale(width, height, imgW, imgH, item)
  const sw = imgW * scale
  const sh = imgH * scale
  const x = (width - sw) / 2
  const y = (height - sh) / 2
  // `invert` is applied by the caller on the sampled pixel buffer
  // (invertPixels), not via ctx.filter, which not every context supports.
  ctx.drawImage(image, x, y, sw, sh)
}
```

`src/raster/rasterize.ts` — after `const img = ctx.getImageData(...)`:

```ts
  if (item.type === 'image' && item.invert) invertPixels(img.data)
```

`src/raster/raster.worker.ts` — after `const img = ctx.getImageData(w, h)` line:

```ts
  if (req.item.type === 'image' && req.item.invert) invertPixels(img.data)
```

(both import `invertPixels` from `./sample`).

- [ ] **Step 4: Verify + commit**

```bash
bun test && bun run type-check && bun run lint:fix
git add src/raster/sample.ts src/raster/draw.ts src/raster/rasterize.ts src/raster/raster.worker.ts test/raster/sample.test.ts
git commit -m "fix: invert images by pixel walk, not ctx.filter (silently unsupported in some engines)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation sync + final verification (audit #15, wrap-up)

**Files:**
- Modify: `scripts/build-worker.ts:4` ("committed" → gitignored)
- Modify: `CLAUDE.md` (engine-recreation claim, morph parity note, worker lifecycle)

- [ ] **Step 1: build-worker.ts comment** — line 4-5 becomes: "The output is written to src/raster/worker-source.ts (gitignored; regenerated by this script, which runs on install and before `build` and `dev`)."

- [ ] **Step 2: CLAUDE.md updates**
  - In the `useFieldTargets` sentence (section 1), note it re-rasterizes when **any** raster input changes (item, size, font, alpha, spacing, maxParticles, dprEpoch).
  - In section 3 (Orchestrator), replace any implication that the component recreates the engine on size change with: the component resizes live via `engine.resize`; the engine is recreated only on `backend`/`idle`/DPR-epoch changes.
  - In "Cross-tier render parity", add: reconcile morphs from **home** positions (not live x/y) so CPU and GPU tiers morph identically; the CPU field is not simulated under GPU tiers.
  - In section 1, note the raster worker self-terminates after ~10 s idle and is respawned on demand.

- [ ] **Step 3: Full verification suite**

```bash
bun run build && bun run type-check && bun run lint && bun test
```
Expected: build produces `dist/`, everything green.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-worker.ts CLAUDE.md docs/superpowers/plans/2026-07-10-robustness-fixes.md
git commit -m "docs: sync CLAUDE.md and comments with live-resize/parity/worker changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Self-Review

- **Spec coverage:** #1→T1, #2/#3→T5, #4→T6, #5→T4, #6→T2, #7→T9, #8→T10, #9→T7 (+T8 fold-in), #10→T3, #11/#14a→T11, #12→T8, #13→T13, #14b→T12, #15→T8/T14, #16→tests in T2/T3/T4/T5/T12/T13. All 16 covered.
- **Type consistency:** `FieldDelta` shrink (T3) precedes GPU edits (T9/T10) which no longer reference `overlap`/`relocate`; `useFieldTargets` 8-arg signature (T5) matches the component call (T5 stub → T8 real value); `Pipelines.simUniformStride` produced (T9) and consumed in the same task.
- **Ordering note:** T5 introduces the `dprEpoch` parameter with a literal `0`; T8 replaces it with the real state. Executing T5 before T8 keeps every intermediate commit green.
