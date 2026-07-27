# Params API Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dotimation's flat tuning props with grouped `dots` + `motion` config objects, expose the hardcoded motion constants (jitter, settle time, damping, fade) as live-updatable knobs, and delete the `idle` prop (loop policy derives from effective jitter).

**Architecture:** A new pure module `src/engine/params.ts` owns option types, defaults, sanitization, and the single `tuneSpring` application producing a `SimParams` object. All three backends consume a live `SimParams` via a new `Backend.setParams` (replacing `setDotSize`); the engine derives its settle duration and its continuous-vs-sleep loop policy from the same object. The raster path renames `alpha`/`pointSpacingCss`/`maxParticles` → `threshold`/`spacing`/`max` end-to-end.

**Tech Stack:** Bun (only toolchain), TypeScript with `isolatedDeclarations` + `noUncheckedIndexedAccess`, Biome (single quotes, no semicolons), React 19, `bun test` for pure cores, Playwright e2e for DOM shells.

**Spec:** `docs/superpowers/specs/2026-07-28-params-api-redesign-design.md` — read it before starting any task.

## Global Constraints

- Bun only: `bun install`, `bun test`, `bun run type-check`, `bun run lint:fix`. Never npm/yarn/pnpm.
- `isolatedDeclarations: true` — every exported symbol needs an explicit type annotation (including `export const X: number = ...`).
- `noUncheckedIndexedAccess: true` — use `arr[i]!` non-null assertions on hot paths (established convention; Biome allows it).
- Formatting is Biome-owned: single quotes, no semicolons, 2-space indent. Run `bun run lint:fix` before every commit (pre-commit hook runs `lint` + `type-check`; type-check covers `src/**` only).
- Path alias `@/*` → `src/*` exists; match the import style of the file you're editing.
- Every commit must leave `bun run type-check`, `bun run lint`, and `bun test` green.
- Do NOT add `"sideEffects": false` to package.json (breaks the bundle).
- Defaults must reproduce 0.6.0 visuals exactly: size 1, spacing 2, threshold 128, max unbounded, jitter 1, settleTime 0.85, damping 1, fade 2, colorRate 2.
- Working branch: `feat/params-api` (already created; spec is committed on it).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pure params core (`src/engine/params.ts`)

**Files:**
- Create: `src/engine/params.ts`
- Create: `test/engine/params.test.ts`
- Modify: `src/engine/constants.ts` (slim to derived re-exports; deleted for good in Task 5)
- Modify: `src/backends/gpu-shared.ts` (add `fadeDurationMs(rate)`)
- Modify: `test/backends/gpu-shared.test.ts` (cover `fadeDurationMs`)

**Interfaces:**
- Consumes: `tuneSpring({ settleTime, zeta })` from `src/engine/settle.ts` (exists).
- Produces (later tasks rely on these exact names):
  - `interface DotOptions { size?: number; spacing?: number; threshold?: number; max?: number }`
  - `interface MotionOptions { jitter?: number; settleTime?: number; damping?: number; fade?: number }`
  - `interface ResolvedDots { size: number; spacing: number; threshold: number; max: number }`
  - `interface ResolvedMotion { jitter: number; settleTime: number; damping: number; fade: number }`
  - `interface SimParams { dotSize: number; jitter: number; k: number; c: number; settleTime: number; opacityRate: number; colorRate: number }`
  - `resolveDots(input?: DotOptions): ResolvedDots`
  - `resolveMotion(input?: MotionOptions): ResolvedMotion`
  - `toSimParams(motion: ResolvedMotion, dotSize: number, reduced: boolean): SimParams`
  - Constants: `DEFAULT_DOTS: ResolvedDots`, `DEFAULT_MOTION: ResolvedMotion`, `COLOR_RATE: number` (= 2), `MIN_SETTLE_TIME: number` (= 0.2), `MIN_DAMPING: number` (= 0.3)
  - `fadeDurationMs(opacityRate: number): number` from `src/backends/gpu-shared.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/engine/params.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DOTS,
  DEFAULT_MOTION,
  MIN_DAMPING,
  MIN_SETTLE_TIME,
  resolveDots,
  resolveMotion,
  toSimParams,
} from '../../src/engine/params'
import { tuneSpring } from '../../src/engine/settle'

describe('resolveDots', () => {
  test('no input yields defaults', () => {
    expect(resolveDots()).toEqual(DEFAULT_DOTS)
    expect(resolveDots({})).toEqual(DEFAULT_DOTS)
  })

  test('partial input keeps other defaults', () => {
    const r = resolveDots({ size: 3 })
    expect(r.size).toBe(3)
    expect(r.spacing).toBe(DEFAULT_DOTS.spacing)
    expect(r.threshold).toBe(DEFAULT_DOTS.threshold)
    expect(r.max).toBe(DEFAULT_DOTS.max)
  })

  test('sanitizes size: non-positive or non-finite falls back to default', () => {
    expect(resolveDots({ size: 0 }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: -2 }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: Number.NaN }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: Number.POSITIVE_INFINITY }).size).toBe(
      DEFAULT_DOTS.size,
    )
  })

  test('clamps spacing to >= 1', () => {
    expect(resolveDots({ spacing: 0.25 }).spacing).toBe(1)
    expect(resolveDots({ spacing: 5 }).spacing).toBe(5)
    expect(resolveDots({ spacing: Number.NaN }).spacing).toBe(
      DEFAULT_DOTS.spacing,
    )
  })

  test('clamps threshold to [0, 255]', () => {
    expect(resolveDots({ threshold: -10 }).threshold).toBe(0)
    expect(resolveDots({ threshold: 300 }).threshold).toBe(255)
    expect(resolveDots({ threshold: Number.NaN }).threshold).toBe(
      DEFAULT_DOTS.threshold,
    )
  })

  test('max: floors, clamps to >= 0, Infinity stays unbounded, NaN defaults', () => {
    expect(resolveDots({ max: 100.9 }).max).toBe(100)
    expect(resolveDots({ max: -5 }).max).toBe(0)
    expect(resolveDots({ max: Number.POSITIVE_INFINITY }).max).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(resolveDots({ max: Number.NaN }).max).toBe(DEFAULT_DOTS.max)
  })
})

describe('resolveMotion', () => {
  test('no input yields defaults', () => {
    expect(resolveMotion()).toEqual(DEFAULT_MOTION)
    expect(resolveMotion({})).toEqual(DEFAULT_MOTION)
  })

  test('jitter: clamps negatives to 0, non-finite defaults', () => {
    expect(resolveMotion({ jitter: -1 }).jitter).toBe(0)
    expect(resolveMotion({ jitter: 0 }).jitter).toBe(0)
    expect(resolveMotion({ jitter: 2.5 }).jitter).toBe(2.5)
    expect(resolveMotion({ jitter: Number.NaN }).jitter).toBe(
      DEFAULT_MOTION.jitter,
    )
  })

  test('settleTime: floored at MIN_SETTLE_TIME, non-positive defaults', () => {
    expect(resolveMotion({ settleTime: 0.05 }).settleTime).toBe(
      MIN_SETTLE_TIME,
    )
    expect(resolveMotion({ settleTime: 2 }).settleTime).toBe(2)
    expect(resolveMotion({ settleTime: 0 }).settleTime).toBe(
      DEFAULT_MOTION.settleTime,
    )
    expect(resolveMotion({ settleTime: -1 }).settleTime).toBe(
      DEFAULT_MOTION.settleTime,
    )
  })

  test('damping: clamped to [MIN_DAMPING, 1]', () => {
    expect(resolveMotion({ damping: 0.05 }).damping).toBe(MIN_DAMPING)
    expect(resolveMotion({ damping: 3 }).damping).toBe(1)
    expect(resolveMotion({ damping: 0.5 }).damping).toBe(0.5)
    expect(resolveMotion({ damping: Number.NaN }).damping).toBe(
      DEFAULT_MOTION.damping,
    )
  })

  test('fade: non-positive or non-finite defaults', () => {
    expect(resolveMotion({ fade: 0 }).fade).toBe(DEFAULT_MOTION.fade)
    expect(resolveMotion({ fade: -2 }).fade).toBe(DEFAULT_MOTION.fade)
    expect(resolveMotion({ fade: 4 }).fade).toBe(4)
  })
})

describe('toSimParams', () => {
  test('applies tuneSpring and carries fields through', () => {
    const m = resolveMotion({ settleTime: 0.5, damping: 0.8, fade: 3 })
    const p = toSimParams(m, 2, false)
    const { k, c } = tuneSpring({ settleTime: 0.5, zeta: 0.8 })
    expect(p.k).toBe(k)
    expect(p.c).toBe(c)
    expect(p.dotSize).toBe(2)
    expect(p.jitter).toBe(m.jitter)
    expect(p.settleTime).toBe(0.5)
    expect(p.opacityRate).toBe(3)
    expect(p.colorRate).toBe(2)
  })

  test('reduced motion zeroes jitter but nothing else', () => {
    const p = toSimParams(resolveMotion({ jitter: 5 }), 1, true)
    expect(p.jitter).toBe(0)
    expect(p.opacityRate).toBe(DEFAULT_MOTION.fade)
  })

  test('defaults reproduce the 0.6.0 constants', () => {
    const p = toSimParams(resolveMotion(), 1, false)
    const legacy = tuneSpring({ settleTime: 0.85, zeta: 1 })
    expect(p.k).toBe(legacy.k)
    expect(p.c).toBe(legacy.c)
    expect(p.jitter).toBe(1)
    expect(p.opacityRate).toBe(2)
    expect(p.colorRate).toBe(2)
  })
})
```

Add to `test/backends/gpu-shared.test.ts` (keep existing tests):

```ts
import { fadeDurationMs } from '../../src/backends/gpu-shared'

describe('fadeDurationMs', () => {
  test('is fade time plus 150ms margin, in ms', () => {
    expect(fadeDurationMs(2)).toBe((1 / 2 + 0.15) * 1000)
    expect(fadeDurationMs(4)).toBe((1 / 4 + 0.15) * 1000)
  })
})
```

(Match the existing import style in that file — it may import `describe/expect/test` already.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/engine/params.test.ts test/backends/gpu-shared.test.ts`
Expected: FAIL — `params.ts` doesn't exist; `fadeDurationMs` not exported.

- [ ] **Step 3: Implement `src/engine/params.ts`**

```ts
import { tuneSpring } from './settle'

/** User-facing dot field options (the `dots` prop). All optional. */
export interface DotOptions {
  /** Dot footprint in CSS px (scales with devicePixelRatio). @default 1 */
  size?: number
  /** Sampling grid step in CSS px; larger = sparser dots. Min 1. @default 2 */
  spacing?: number
  /** Alpha cutoff (0-255) a source pixel must exceed to become a dot. @default 128 */
  threshold?: number
  /** Cap on total particles (uniform random subset). @default unbounded */
  max?: number
}

/** User-facing motion options (the `motion` prop). All optional. */
export interface MotionOptions {
  /** Shimmer amplitude in px per physics step; 0 disables. @default 1 */
  jitter?: number
  /** Seconds for a morph to converge. Floored at 0.2. @default 0.85 */
  settleTime?: number
  /** Damping ratio: 1 = no overshoot, lower = bouncier. Clamped to [0.3, 1]. @default 1 */
  damping?: number
  /** Opacity ease rate per second for fade-in/out. @default 2 */
  fade?: number
}

export interface ResolvedDots {
  size: number
  spacing: number
  threshold: number
  max: number
}

export interface ResolvedMotion {
  jitter: number
  settleTime: number
  damping: number
  fade: number
}

/**
 * Everything the engine and backends need per instance, derived in one place
 * (`toSimParams`) so the three tiers cannot drift. Applied live via
 * Engine.setParams / Backend.setParams — no recreation on change.
 */
export interface SimParams {
  dotSize: number
  jitter: number
  k: number
  c: number
  settleTime: number
  opacityRate: number
  colorRate: number
}

/** Per-second color ease rate toward home color. Internal (not user-exposed). */
export const COLOR_RATE = 2

export const DEFAULT_DOTS: ResolvedDots = {
  size: 1,
  spacing: 2,
  threshold: 128,
  max: Number.POSITIVE_INFINITY,
}

export const DEFAULT_MOTION: ResolvedMotion = {
  jitter: 1,
  settleTime: 0.85,
  damping: 1,
  fade: 2,
}

/**
 * Integrator-stability floors. The spring runs semi-implicit Euler at 90 Hz
 * (FIXED_DT = 1/90), stable roughly while wn*dt < 2 with wn = 4/(zeta*settleTime).
 * These floors give worst-case wn = 4/(0.3*0.2) ~= 66.7 -> wn*dt ~= 0.74,
 * comfortably stable with margin for the jitter forcing. tuneSpring's settling
 * formula additionally requires zeta <= 1.
 */
export const MIN_SETTLE_TIME = 0.2
export const MIN_DAMPING = 0.3

function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Fills defaults and sanitizes out-of-range input (silently — degrade, never throw). */
export function resolveDots(input?: DotOptions): ResolvedDots {
  const size = num(input?.size, DEFAULT_DOTS.size)
  const spacing = num(input?.spacing, DEFAULT_DOTS.spacing)
  const threshold = num(input?.threshold, DEFAULT_DOTS.threshold)
  // Infinity is the valid "unbounded" value for max, so only NaN falls back.
  const rawMax = input?.max
  const max =
    typeof rawMax === 'number' && !Number.isNaN(rawMax)
      ? Math.max(0, Math.floor(rawMax))
      : DEFAULT_DOTS.max
  return {
    size: size > 0 ? size : DEFAULT_DOTS.size,
    spacing: Math.max(1, spacing),
    threshold: Math.min(255, Math.max(0, threshold)),
    max,
  }
}

/** Fills defaults and sanitizes; see MIN_SETTLE_TIME / MIN_DAMPING for the floors. */
export function resolveMotion(input?: MotionOptions): ResolvedMotion {
  const jitter = num(input?.jitter, DEFAULT_MOTION.jitter)
  const settleTime = num(input?.settleTime, DEFAULT_MOTION.settleTime)
  const damping = num(input?.damping, DEFAULT_MOTION.damping)
  const fade = num(input?.fade, DEFAULT_MOTION.fade)
  return {
    jitter: Math.max(0, jitter),
    settleTime: Math.max(
      MIN_SETTLE_TIME,
      settleTime > 0 ? settleTime : DEFAULT_MOTION.settleTime,
    ),
    damping: Math.min(1, Math.max(MIN_DAMPING, damping)),
    fade: fade > 0 ? fade : DEFAULT_MOTION.fade,
  }
}

/**
 * The single place tuneSpring is applied. `reduced` zeroes the jitter
 * (accessibility always wins over the motion prop).
 */
export function toSimParams(
  motion: ResolvedMotion,
  dotSize: number,
  reduced: boolean,
): SimParams {
  const { k, c } = tuneSpring({
    settleTime: motion.settleTime,
    zeta: motion.damping,
  })
  return {
    dotSize,
    jitter: reduced ? 0 : motion.jitter,
    k,
    c,
    settleTime: motion.settleTime,
    opacityRate: motion.fade,
    colorRate: COLOR_RATE,
  }
}
```

- [ ] **Step 4: Slim `src/engine/constants.ts` to derived re-exports**

Replace the whole file with (it is deleted entirely in Task 5; this keeps the
not-yet-migrated importers — engine, backends, component — compiling and
provably in sync with the new defaults):

```ts
/**
 * TRANSITIONAL — being absorbed into src/engine/params.ts (see the 2026-07-28
 * params-api spec). These derived aliases keep not-yet-migrated importers on
 * the exact same values as the new defaults. Deleted in the final API task.
 */
import { COLOR_RATE as PARAMS_COLOR_RATE, DEFAULT_MOTION } from './params'

export const SETTLE_TIME: number = DEFAULT_MOTION.settleTime
export const ZETA: number = DEFAULT_MOTION.damping
export const OPACITY_RATE: number = DEFAULT_MOTION.fade
export const COLOR_RATE: number = PARAMS_COLOR_RATE
export const JITTER_AMOUNT: number = DEFAULT_MOTION.jitter
```

- [ ] **Step 5: Add `fadeDurationMs` to `src/backends/gpu-shared.ts`**

Replace the `FADE_DURATION_MS` block (and its `OPACITY_RATE` import — import
`DEFAULT_MOTION` from `@/engine/params` instead) with:

```ts
/**
 * Faders fade out at the live opacity rate; after this long they are invisible
 * and the tail can be dropped. The Canvas2D backend compacts faders in
 * stepField; the GPU sims don't change count, so the backends expire them by
 * elapsed time, computed from the current rate.
 */
export function fadeDurationMs(opacityRate: number): number {
  return (1 / opacityRate + 0.15) * 1000
}

/** TRANSITIONAL default-rate alias — removed in the backends task. */
export const FADE_DURATION_MS: number = fadeDurationMs(DEFAULT_MOTION.fade)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test`
Expected: ALL PASS (params + gpu-shared new tests, plus the whole existing suite — the derived constants must equal the old literals).

- [ ] **Step 7: Lint, type-check, commit**

```bash
bun run lint:fix && bun run type-check
git add src/engine/params.ts src/engine/constants.ts src/backends/gpu-shared.ts test/engine/params.test.ts test/backends/gpu-shared.test.ts
git commit -m "feat: pure params core — DotOptions/MotionOptions resolution and SimParams

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Backends consume live `SimParams` (`setParams`)

**Files:**
- Modify: `src/types.ts` (Backend interface: add `setParams`)
- Modify: `src/backends/canvas2d/simulate.ts` (StepParams signature)
- Modify: `src/backends/canvas2d/index.ts`
- Modify: `src/backends/webgl2/index.ts`
- Modify: `src/backends/webgpu/index.ts`
- Modify: `src/backends/gpu-shared.ts` (remove transitional `FADE_DURATION_MS`)
- Modify: `src/engine/select.ts` (SelectOptions carries `params`)
- Modify: `src/components/dotimation.tsx` (one call site: build interim SimParams)
- Modify: `test/backends/canvas2d/simulate.test.ts`

**Interfaces:**
- Consumes (Task 1): `SimParams`, `toSimParams`, `resolveMotion`, `fadeDurationMs` from `@/engine/params` / `../gpu-shared`.
- Produces:
  - `src/backends/canvas2d/simulate.ts`: `interface StepParams { k: number; c: number; jitter: number; opacityRate: number; colorRate: number }` and `stepField(field: ParticleField, dt: number, p: StepParams, rand: () => number = fastRand): boolean` (note: `SimParams` structurally satisfies `StepParams` — backends pass their live params object straight through).
  - `Backend.setParams(params: SimParams): void` on the `Backend` interface (in `src/types.ts`, importing the type via `import type { SimParams } from '@/engine/params'`). `Backend.setDotSize` REMAINS in this task (the engine still calls it) and is deleted in Task 3.
  - Backend factories now take the full params: `createCanvas2DBackend(initial: SimParams)`, `createWebGL2Backend(initial: SimParams)`, `createWebGPUBackend(initial: SimParams)` — the old `{ dotSize, jitter }` option interfaces (`Canvas2DOptions`, `WebGL2Options`, `WebGPUOptions`) are deleted.
  - `src/engine/select.ts`: `SelectOptions` becomes `{ requested: BackendKind; params: SimParams; canvas: HTMLCanvasElement; dpr: number }`; `construct(kind, params)` forwards it.

- [ ] **Step 1: Update `simulate.test.ts` to the new signature (failing first)**

In `test/backends/canvas2d/simulate.test.ts`, the existing calls look like
`stepField(field, dt, k, c, rand, jitter)`. Rewrite every call to
`stepField(field, dt, { k, c, jitter, opacityRate: 2, colorRate: 2 }, rand)`
(keep each test's existing k/c/jitter values; where a test relied on the old
defaulted jitter, pass `jitter: 1`). Then ADD these tests:

```ts
import { tuneSpring } from '../../../src/engine/settle'
import {
  MIN_DAMPING,
  MIN_SETTLE_TIME,
} from '../../../src/engine/params'
import { FIXED_DT } from '../../../src/engine/clock'

describe('stepField stability and rates', () => {
  test('remains finite and converges at the stability floors', () => {
    const field = createField(4)
    field.active = 4
    field.count = 4
    for (let i = 0; i < 4; i++) {
      field.x[i] = 500
      field.y[i] = 500
      field.homeX[i] = i * 10
      field.homeY[i] = i * 5
      field.targetAlpha[i] = 1
    }
    const { k, c } = tuneSpring({
      settleTime: MIN_SETTLE_TIME,
      zeta: MIN_DAMPING,
    })
    const p = { k, c, jitter: 1, opacityRate: 2, colorRate: 2 }
    const rand = () => 0.5 // deterministic: zero jitter offset
    for (let s = 0; s < 5000; s++) stepField(field, FIXED_DT, p, rand)
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(field.x[i]!)).toBe(true)
      expect(Number.isFinite(field.vx[i]!)).toBe(true)
      expect(Math.abs(field.x[i]! - field.homeX[i]!)).toBeLessThan(1)
      expect(Math.abs(field.y[i]! - field.homeY[i]!)).toBeLessThan(1)
    }
  })

  test('opacityRate controls fade-in speed', () => {
    const field = createField(1)
    field.active = 1
    field.count = 1
    field.targetAlpha[0] = 1
    field.alpha[0] = 0
    const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })
    const p = { k, c, jitter: 0, opacityRate: 4, colorRate: 2 }
    // alpha rises by opacityRate*dt per step: reaches 1 after 1/4 s
    const steps = Math.ceil(0.25 / FIXED_DT) + 1
    for (let s = 0; s < steps; s++) stepField(field, FIXED_DT, p, () => 0.5)
    expect(field.alpha[0]!).toBe(1)
  })
})
```

(Use the same `createField` import the file already uses. If it builds fields
by hand instead, follow the file's existing pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/backends/canvas2d/simulate.test.ts`
Expected: FAIL — `stepField` still takes positional `k, c`.

- [ ] **Step 3: Rewrite `stepField` to take `StepParams`**

In `src/backends/canvas2d/simulate.ts`: delete the `COLOR_RATE, JITTER_AMOUNT, OPACITY_RATE` import; add:

```ts
/** The subset of SimParams the CPU sim reads each step (SimParams satisfies it). */
export interface StepParams {
  k: number
  c: number
  jitter: number
  opacityRate: number
  colorRate: number
}
```

New signature and hoisted locals (body otherwise unchanged — keep the compaction loop and comments):

```ts
export function stepField(
  field: ParticleField,
  dt: number,
  p: StepParams,
  rand: () => number = fastRand,
): boolean {
  const { k, c, jitter, opacityRate, colorRate } = p
  // ... existing destructure of field ...
  const colorFactor = 1 - Math.exp(-colorRate * dt)
  const delta = opacityRate * dt
  // ... loop unchanged, but the jitter line reads:
  //   x[i]! += vx[i]! * dt + (rand() - 0.5) * jitter
```

- [ ] **Step 4: Canvas2D backend holds a live params object**

`src/backends/canvas2d/index.ts`: delete the `SETTLE_TIME, ZETA` +
`tuneSpring` imports and the `Canvas2DOptions` interface; the factory becomes:

```ts
import type { SimParams } from '@/engine/params'

export function createCanvas2DBackend(initial: SimParams): Backend {
  // ...
  let p = initial
```

Delete the `let dotSize = opts.dotSize`, `const jitter = opts.jitter`, and
`const { k, c } = tuneSpring(...)` lines. Then:

- `setDotSize(next)` → `p = { ...p, dotSize: next }` (kept until Task 3)
- add `setParams(next: SimParams): void { p = next }`
- `step(dt)` → `if (field) settledFlag = stepField(field, dt, p)`
- `draw()` → every `dotSize` read becomes `p.dotSize` (two spots: `computeDirtyRect(..., p.dotSize)` and `renderField(..., p.dotSize, clearR)`)

- [ ] **Step 5: WebGL2 backend**

`src/backends/webgl2/index.ts`: delete the `COLOR_RATE, OPACITY_RATE, SETTLE_TIME, ZETA` + `tuneSpring` imports and `WebGL2Options`; factory takes `initial: SimParams`; replace `let dotSize`/`const jitter`/`tuneSpring` lines with `let p = initial`. Import `fadeDurationMs` (drop `FADE_DURATION_MS`) from `../gpu-shared`. Then:

- fader expiry: `if (count > active && performance.now() - lastUpload > fadeDurationMs(p.opacityRate))`
- `sim.step(b.read, count, { dt, k: p.k, c: p.c, colorRate: p.colorRate, opacityRate: p.opacityRate, jitter: p.jitter, seed: ... })`
- `draw.use(b.read, count, { devW, devH, dpr, dotSize: p.dotSize })`
- `setDotSize(next)` → `p = { ...p, dotSize: next }`; add `setParams(next: SimParams): void { p = next }`

- [ ] **Step 6: WebGPU backend**

`src/backends/webgpu/index.ts`: same treatment — delete constant/tuneSpring imports and `WebGPUOptions`, `let p = initial`, `fadeDurationMs(p.opacityRate)` for expiry. Uniform writes read `p`:

```ts
simU[1] = p.k
simU[2] = p.c
simU[3] = p.colorRate
simU[4] = p.opacityRate
simU[5] = p.jitter
// ...
renderU[3] = p.dotSize
```

- `setDotSize(next)` → `p = { ...p, dotSize: next }; renderUniformDirty = true`
- add `setParams(next: SimParams): void { p = next; renderUniformDirty = true }` (dotSize may have changed; the sim uniforms are written every stepped frame regardless).

- [ ] **Step 7: Backend interface + select.ts + interim component call site**

`src/types.ts` — add to the `Backend` interface (keep `setDotSize` for now):

```ts
import type { SimParams } from '@/engine/params'
// ...
  /** Apply new sim params (dot size, jitter, spring, fade) live; read at step/draw time. */
  setParams(params: SimParams): void
```

`src/engine/select.ts`:

```ts
import type { SimParams } from './params'

export interface SelectOptions {
  requested: BackendKind
  params: SimParams
  canvas: HTMLCanvasElement
  dpr: number
}

async function construct(
  kind: ConcreteBackend,
  params: SimParams,
): Promise<Backend> {
  if (kind === 'webgpu') {
    return (await import('@/backends/webgpu')).createWebGPUBackend(params)
  }
  if (kind === 'webgl2') {
    return (await import('@/backends/webgl2')).createWebGL2Backend(params)
  }
  return createCanvas2DBackend(params)
}
```

and the loop body: `be = await construct(kind, opts.params)`.

`src/components/dotimation.tsx` — interim edit so the call site compiles with
IDENTICAL behavior (the real dots/motion props arrive in Task 5): replace the
`JITTER_AMOUNT` import with `import { resolveMotion, toSimParams } from '@/engine/params'` and change the `selectBackend` call to:

```ts
selected = await selectBackend({
  requested: backend,
  params: toSimParams(resolveMotion(), constructedDotSize, reduced),
  canvas,
  dpr,
})
```

(`constructedDotSize` already exists in that scope.)

`src/backends/gpu-shared.ts`: delete the transitional `FADE_DURATION_MS` export (both users are migrated) and, if now unused, the `DEFAULT_MOTION` import.

- [ ] **Step 8: Run everything**

Run: `bun test && bun run type-check && bun run lint:fix`
Expected: ALL PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src test
git commit -m "feat: backends consume live SimParams via Backend.setParams

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Engine — `setParams` + loop policy derived from jitter (removes `idle`)

**Files:**
- Modify: `src/engine/engine.ts` (setParams, per-engine settle duration, continuous/sleep policy)
- Modify: `src/types.ts` (delete `IdleBehavior`; delete `Backend.setDotSize`)
- Modify: `src/backends/canvas2d/index.ts`, `src/backends/webgl2/index.ts`, `src/backends/webgpu/index.ts` (delete `setDotSize`)
- Modify: `src/components/dotimation.tsx` (drop `idle` prop + `idleRef` + `setIdle`/`setDotSize` effects; pass `params` to engine; live setParams effect)
- Modify: `test/index.test.ts` — only if it references `IdleBehavior` (check first)

**Interfaces:**
- Consumes: `SimParams`, `toSimParams`, `resolveMotion` (Task 1); `Backend.setParams` (Task 2); `computeSettleDuration(settleTime, opacityRate)` (exists).
- Produces:
  - `EngineOptions` = `{ backend: Backend; canvas: HTMLCanvasElement; dpr: number; params: SimParams }`
  - `Engine` = `{ setField(field, full?): void; setParams(params: SimParams): void; resize(devW, devH): void; dispose(): void }` — `setDotSize`/`setIdle` are GONE.
  - Loop policy: `continuous = params.jitter > 0` → run whenever visible; otherwise settle/sleep exactly as before.
- KNOWN INTERIM BREAKAGE: `test/ui` (playground) still uses `idle`/`IdleBehavior` and old props — it is NOT covered by root type-check and is migrated in Task 6. Do not touch it here.

- [ ] **Step 1: Check `test/index.test.ts`**

Run: `grep -n "IdleBehavior\|idle" test/index.test.ts`
If it asserts the public export surface includes `IdleBehavior`, update that expectation to exclude it (and to expect `DotOptions`/`MotionOptions` NOT yet — they're exported in Task 5).

- [ ] **Step 2: Rewrite `src/engine/engine.ts`**

Full new content (comments preserved/adapted):

```ts
import type { Backend, ParticleField } from '@/types'
import { accumulate, FIXED_DT } from './clock'
import type { SimParams } from './params'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  params: SimParams
}

export interface Engine {
  /** Push a reconciled field; `full` is forwarded to Backend.uploadField. */
  setField(field: ParticleField, full?: boolean): void
  /**
   * Apply new sim params live (dot size, jitter, spring, fade) without
   * recreating anything. Also re-derives the loop policy: jitter > 0 means
   * the shimmer must stay visible, so the loop runs whenever on-screen;
   * jitter === 0 means nothing moves once settled, so the loop sleeps.
   */
  setParams(params: SimParams): void
  /**
   * Resize in place without tearing down the engine — the component calls this
   * on width/height changes so simulation state survives across resizes.
   */
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas } = opts
  let params = opts.params
  let settleSeconds = computeSettleDuration(
    params.settleTime,
    params.opacityRate,
  )
  let continuous = params.jitter > 0
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let awakeUntil = 0
  let visible = true

  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    // Draw unconditionally while running: a skipped present is what made
    // cleared-buffer flicker possible on high-refresh displays, and skipping
    // was only ever worth it when preserveDrawingBuffer paid for it on every
    // real present.
    backend.draw()
    // With jitter active the field never converges (by design), so the
    // settled() early-sleep only applies on the jitter === 0 path.
    if (!continuous && (now >= awakeUntil || backend.settled?.())) {
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
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

  const wake = (): void => {
    awakeUntil = performance.now() + settleSeconds * 1000
    if (!running && visible) start()
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            // Continuous (jitter > 0) must run whenever on-screen; otherwise
            // only resume if still inside the wake window.
            if (continuous || performance.now() < awakeUntil) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field, full): void {
      backend.uploadField(field, full)
      wake()
    },
    setParams(next): void {
      params = next
      backend.setParams(next)
      settleSeconds = computeSettleDuration(next.settleTime, next.opacityRate)
      continuous = next.jitter > 0
      if (continuous) {
        if (visible && !running) start()
      } else {
        // One settle window so an in-flight morph (or a fresh dot size)
        // paints before the loop stops itself.
        wake()
      }
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

- [ ] **Step 3: Delete `setDotSize` and `IdleBehavior`**

- `src/types.ts`: remove the `IdleBehavior` type and the `setDotSize` method from `Backend` (keep `setParams` with its doc comment).
- All three backends: delete their `setDotSize` implementations.
- Verify no stragglers: `grep -rn "setDotSize\|IdleBehavior\|setIdle" src/` → must return nothing.

- [ ] **Step 4: Component minimal migration (props unchanged except `idle` removed)**

In `src/components/dotimation.tsx`:

1. Remove `idle = 'sleep'` from the destructured props and `idle?: IdleBehavior` (+ its import) from `DotimationProps`.
2. Delete the `idleRef` block and the `setIdle` effect.
3. Replace the `dotSizeRef` block with a params ref (same comment rationale — the creation effect reads it without depending on it):

```ts
// Sim params are read at step/draw time, so they update live without
// recreating the engine. The creation effect reads them through this ref to
// avoid listing them as dependencies (which would tear down the engine and
// reset the field).
const simParams = toSimParams(resolveMotion(), dotSize, reduced)
const simParamsRef = useRef(simParams)
simParamsRef.current = simParams
```

(`dotSize` prop still exists until Task 5; `resolveMotion()` yields defaults.)

4. In the creation effect: delete `constructedDotSize`/`constructedIdle`; pass
`params: simParamsRef.current` to both `selectBackend({ requested: backend, params: simParamsRef.current, canvas, dpr })` and `createEngine({ backend: selected.backend, canvas, dpr, params: simParamsRef.current })`. Replace the two post-construction catch-up blocks (`dotSize may have changed...` and `Likewise idle...`) with one unconditional catch-up (cheap, idempotent, and immune to the object identity changing every render):

```ts
// Params may have changed while the backend was initializing; the live
// effect ran against a null engineRef and was dropped. Re-applying is cheap.
engine.setParams(simParamsRef.current)
```

5. Replace the `setDotSize` effect with:

```ts
// Motion/dot-size changes are pushed to the live engine — never a recreation.
// Deps are the resolved primitives, so inline object literals cost nothing.
useEffect(() => {
  engineRef.current?.setParams(simParamsRef.current)
}, [dotSize, reduced])
```

- [ ] **Step 5: Run everything**

Run: `bun test && bun run type-check && bun run lint:fix`
Expected: ALL PASS. (Playground breakage is expected and deferred to Task 6.)

- [ ] **Step 6: Manual sanity check in the playground is NOT possible yet** (it still uses `idle`). Skip; e2e covers this in Task 6.

- [ ] **Step 7: Commit**

```bash
git add -A src test
git commit -m "feat!: engine loop policy derived from jitter; remove idle prop and setDotSize

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Raster vocabulary rename (`threshold` / `spacing` / `max`)

**Files:**
- Modify: `src/raster/inputs.ts`, `src/raster/sample.ts`, `src/raster/rasterize.ts`, `src/raster/raster.worker.ts`, `src/raster/rasterize-worker.ts`, `src/hooks/use-field-targets.ts`, `src/components/dotimation.tsx` (positional call site only)
- Modify: `test/raster/inputs.test.ts`, `test/raster/sample.test.ts`

**Interfaces:**
- Produces (Task 5 relies on these):
  - `RasterInputs` fields become `threshold: number; spacing: number; max: number` (replacing `alpha`, `pointSpacingCss`, `maxParticles`; all other fields unchanged).
  - `sampleTargets(pixels, devW, devH, dpr, spacingCss: number, threshold: number, rand?, max?: number): FieldTargets`
  - `rasterize(width, height, item, defaultFontFamily, threshold: number, spacingCss: number, max?: number, dpr?: number): Promise<FieldTargets>` (same parameter ORDER as today, only names change)
  - `rasterizeViaWorker(width, height, item, defaultFontFamily, threshold, spacingCss, max, dpr): Promise<FieldTargets>`; the worker request message fields rename identically (`threshold`, `spacingCss`, `max`). The worker source string is regenerated automatically by `bun run dev`/`build` — sender and receiver rename in the same commit, and the generated `worker-source.ts` is gitignored, so there is no protocol-compat concern.
  - `useFieldTargets(item, width, height, defaultFontFamily, threshold, spacing, max, maxDpr, dprEpoch, fontEpoch)` — same positions, new names.
- NOTE: `FieldTargets`/`ParticleField` keep their `alpha` fields — there `alpha` genuinely means opacity. Only the sampling-cutoff sense is renamed.

- [ ] **Step 1: Update the two test files to the new names (failing first)**

`test/raster/inputs.test.ts`: rename every `alpha:` → `threshold:`, `pointSpacingCss:` → `spacing:`, `maxParticles:` → `max:` in the fixture objects.
`test/raster/sample.test.ts`: calls keep the same positional args; only update any named references in test titles/comments. If the file builds options objects, rename accordingly.

Run: `bun test test/raster/` — Expected: FAIL (inputs.test.ts type/shape mismatch at runtime).

- [ ] **Step 2: Apply the rename through the source chain**

Mechanical, same-position renames in: `inputs.ts` (interface fields + `sameRasterInputs` comparisons), `sample.ts` (`pointSpacingCss` param → `spacingCss`, `alpha` param → `threshold`, `maxParticles` → `max`; update the `pixels[idx + 3]! > threshold` line and doc comments), `rasterize.ts`, `raster.worker.ts` (`RasterRequest` fields + `run()` reads), `rasterize-worker.ts` (params + `postMessage` payload), `use-field-targets.ts` (params, destructure, `RasterInputs` construction, dep array), and the `useFieldTargets(...)` call in `dotimation.tsx` — the component still passes its old-named prop variables positionally: `useFieldTargets(item, width, height, defaultFontFamily, alpha, pointSpacingCss, maxParticles, maxDpr, dprEpoch, fontEpoch)` stays VALID because the hook params are positional; leave the component untouched except nothing — verify it compiles.

- [ ] **Step 3: Run everything**

Run: `bun test && bun run type-check && bun run lint:fix`
Expected: ALL PASS. Also run `bun run build` once to confirm the worker regenerates and bundles cleanly.

- [ ] **Step 4: Commit**

```bash
git add -A src test
git commit -m "refactor: rename raster inputs to threshold/spacing/max end-to-end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Component public API — `dots` + `motion` props (the breaking swap)

**Files:**
- Modify: `src/components/dotimation.tsx`
- Modify: `src/types.ts` (re-export `DotOptions`/`MotionOptions`)
- Delete: `src/engine/constants.ts`
- Modify: `test/index.test.ts` (public surface expectations, if any)

**Interfaces:**
- Consumes: `resolveDots`, `resolveMotion`, `toSimParams`, `DotOptions`, `MotionOptions` (Task 1); `Engine.setParams` (Task 3); renamed `useFieldTargets` (Task 4).
- Produces (final public API):
  - `DotimationProps`: `dots?: DotOptions` and `motion?: MotionOptions` REPLACE `dotSize`, `pointSpacingCss`, `alpha`, `maxParticles`. `canvasRef` is deleted. `idle` already gone (Task 3). Everything else unchanged.
  - `src/types.ts` gains `export type { DotOptions, MotionOptions } from '@/engine/params'` so the package root exports them.

- [ ] **Step 1: Component prop swap**

In `src/components/dotimation.tsx`:

1. Props type:

```ts
type DotimationProps = SizeProps & {
  item: AnimateItem
  /** React 19 ref to the underlying canvas element. */
  ref?: React.Ref<HTMLCanvasElement>
  /**
   * Accessible name for the canvas (rendered with role="img"). Defaults to the
   * text content for text items; supply one for image items.
   */
  ariaLabel?: string
  className?: string
  style?: Omit<React.CSSProperties, 'width' | 'height'>
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** Dot field appearance/sampling. All fields optional; see DotOptions. */
  dots?: DotOptions
  /** Motion feel (jitter, settle time, damping, fade). All fields optional. */
  motion?: MotionOptions
  /** @default 'auto' */
  backend?: BackendKind
  /** Density cap for the canvas backing store (devicePixelRatio is clamped to this). @default 2 */
  maxDpr?: number
  /**
   * Force reduced-motion behavior (morphs snap, no shimmer) on or off. Omit to
   * follow the OS prefers-reduced-motion setting — pass this when your app has
   * its own motion preference.
   */
  reducedMotion?: boolean
  /**
   * How particles are assigned to the next layout's dots. 'swarm' (random
   * correspondence) reads as a chaotic cloud; 'nearest' pairs each particle
   * with a nearby destination for a calmer, directed morph. Applies from the
   * next content change. @default 'swarm'
   */
  matching?: 'swarm' | 'nearest'
  onStats?: (stats: DotimationStats) => void
}
```

2. Destructure `dots` and `motion` (no defaults needed — resolvers handle it); delete `canvasRef` from props, its destructure, and its `useImperativeHandle` line. Delete the old `dotSize = 1`, `alpha = 128`, `pointSpacingCss = 2`, `maxParticles = ...` defaults.

3. Resolve once per render, right after the destructure:

```ts
// Resolved to primitives here; every hook/effect below depends on the
// primitive fields, never object identity — inline literals cost nothing.
const d = resolveDots(dots)
const m = resolveMotion(motion)
```

4. `useFieldTargets(item, width, height, defaultFontFamily, d.threshold, d.spacing, d.max, maxDpr, dprEpoch, fontEpoch)`.

5. The Task 3 interim params line becomes the real one:

```ts
const simParams = toSimParams(m, d.size, reduced)
```

6. The live-params effect deps become the resolved primitives:

```ts
useEffect(() => {
  engineRef.current?.setParams(simParamsRef.current)
}, [d.size, m.jitter, m.settleTime, m.damping, m.fade, reduced])
```

(Biome may flag the deps as not literally referenced inside the effect — if it
does, read `simParamsRef` fields via the resolved values instead:
`engineRef.current?.setParams(toSimParams(m, d.size, reduced))` with the same
dep list, and delete nothing else.)

- [ ] **Step 2: Public type exports + constants deletion**

- `src/types.ts`: add `export type { DotOptions, MotionOptions } from '@/engine/params'` (match the file's import style — it has no `@/` imports today, so use `'./engine/params'` if that's more consistent).
- Verify then delete the transitional constants: `grep -rn "engine/constants" src/` → must be empty → `git rm src/engine/constants.ts`.
- Check `test/index.test.ts`: if it enumerates exports, add `DotOptions`/`MotionOptions` expectations and confirm removed ones are gone.

- [ ] **Step 3: Run everything**

Run: `bun test && bun run type-check && bun run lint:fix && bun run build`
Expected: ALL PASS; `dist/index.js` is non-trivial in size (see CLAUDE.md gotcha).

- [ ] **Step 4: Commit**

```bash
git add -A src test
git commit -m "feat!: grouped dots/motion props replace flat tuning props

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Playground + e2e migration (with motion controls)

**Files:**
- Modify: `test/ui/src/config/types.ts`, `test/ui/src/config/presets.ts`
- Modify: `test/ui/src/components/inspector/rendering-controls.tsx` (+ sibling inspector files as needed — read the directory first)
- Modify: `test/ui/src/components/stage/stage.tsx`
- Modify: `test/e2e/smoke.e2e.ts`

**Interfaces:**
- Consumes: the final public API from Task 5 (`dots?: DotOptions`, `motion?: MotionOptions`, no `idle`/`dotSize`/`alpha`/`pointSpacingCss`/`maxParticles`/`canvasRef`).
- Produces: a playground whose inspector can drive all four motion knobs and the four dot knobs live, and an e2e suite that verifies the new loop policy.

- [ ] **Step 1: Migrate the playground config**

Read all of `test/ui/src/config/` and the inspector components first. Then, in the playground's config state (keep its flat-state architecture — it's a dev tool):

- `types.ts`: drop the `IdleBehavior` import; delete the `idle` field; rename the flat fields to the library vocabulary — `dotSize` → `size`, `pointSpacingCss` → `spacing`, `alpha` → `threshold`, `maxParticles` → `max` — and add `jitter: number`, `settleTime: number`, `damping: number`, `fade: number`.
- `presets.ts`: update the defaults object to `size: 1, spacing: 2, threshold: 128, max: undefined, jitter: 1, settleTime: 0.85, damping: 1, fade: 2` (delete `idle`).
- `stage.tsx`: build the props:

```tsx
<Dotimation
  // ...existing item/size/backend/matching/etc...
  dots={{ size: cfg.size, spacing: cfg.spacing, threshold: cfg.threshold, max: cfg.max }}
  motion={{ jitter: cfg.jitter, settleTime: cfg.settleTime, damping: cfg.damping, fade: cfg.fade }}
/>
```

- `rendering-controls.tsx` (follow the file's existing slider/control idiom exactly): keep the existing size/spacing/threshold/max controls under their new names and add four motion sliders — jitter [0, 4] step 0.1, settleTime [0.2, 3] step 0.05, damping [0.3, 1] step 0.05, fade [0.5, 8] step 0.5.

- [ ] **Step 2: Verify the playground by hand**

Run: `bun run dev` — open it; flip through all three backends; drag every new slider; confirm: shimmer never freezes with jitter > 0, jitter 0 goes still after morphs finish, damping < 1 overshoots, settleTime visibly changes morph speed, and no console errors. Check CPU: with jitter 0 and content settled, the tab's rAF should go quiet (DevTools performance monitor).

- [ ] **Step 3: Migrate + extend the e2e suite**

Read `test/e2e/smoke.e2e.ts` fully first; follow its existing scenario/log pattern and helpers (e.g. the painted-pixel probe). Update any usage of removed props. Add three scenarios (names/log lines following the file's style):

1. **shimmer persists**: default motion; wait ~3 s after first paint (past the old settle window), take two canvas pixel snapshots ~500 ms apart → they DIFFER (loop still running).
2. **jitter 0 sleeps**: render with `motion={{ jitter: 0 }}` (drive via the playground's config mechanism the file already uses — likely URL params or in-page controls; if the playground lacks a hook for this, add a query-param override in the playground config for e2e use); wait ~3 s, two snapshots ~500 ms apart → IDENTICAL (canvas stable), and painted-pixel count > 0 (it did render).
3. **live motion change is seamless**: change jitter via the playground controls (whatever mechanism scenario 2 established), assert the canvas ELEMENT identity is unchanged (`page.evaluate` capturing a `data-*` stamp set beforehand, or comparing the element handle) and painted pixels remain > 0 immediately after the change (no blank/recreate).

- [ ] **Step 4: Run e2e**

Run: `bun run test:e2e` (needs `bunx playwright install chromium` once).
Expected: ALL scenarios pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add -A test
git commit -m "test: migrate playground and e2e to dots/motion API; cover derived loop policy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Docs — README migration guide + CLAUDE.md sync

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** none — prose only, but every claim must match the shipped code. Re-read the final `dotimation.tsx` props type and `params.ts` before writing.

- [ ] **Step 1: README**

- Replace the props documentation for the removed flat props with `dots` / `motion` sections (document each field, default, and clamp behavior — including sanitize-silently and the damping/settleTime floors).
- Document the derived loop policy under a "Idle & performance" heading: jitter > 0 runs while visible (IntersectionObserver gating; ~0% cost off-screen), jitter 0 sleeps after settle (~0% idle CPU).
- Add a **Migrating from 0.6** table:

| 0.6 | 0.7 |
| --- | --- |
| `dotSize={1.5}` | `dots={{ size: 1.5 }}` |
| `pointSpacingCss={2}` | `dots={{ spacing: 2 }}` |
| `alpha={128}` | `dots={{ threshold: 128 }}` |
| `maxParticles={20000}` | `dots={{ max: 20000 }}` |
| `idle="sleep"` (freeze after settle) | `motion={{ jitter: 0 }}` (calm/static) |
| `idle="animate"` | default behavior — remove the prop |
| `canvasRef={ref}` | `ref={ref}` |

- New knobs get a short "Motion feel" section with 2-3 tuned examples (calm: `{ jitter: 0.3, settleTime: 1.2 }`; snappy: `{ settleTime: 0.35 }`; bouncy: `{ damping: 0.5 }`).

- [ ] **Step 2: CLAUDE.md**

Update to match reality (keep its dense style): constants.ts → params.ts (resolution, clamps, SimParams, single tuneSpring site), Backend interface (`setParams` replaces `setDotSize`), engine (per-engine settle duration, jitter-derived loop policy, no idle), component props section (dots/motion, removed props, canvasRef gone), raster rename (threshold/spacing/max), test inventory additions (params tests, new e2e scenarios).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README migration guide and CLAUDE.md sync for 0.7 params API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `bun install && bun run build && bun run type-check && bun run lint && bun test && bun run test:e2e` — all green.
- [ ] `bun run dev`: hand-verify the four motion sliders on all three backends one last time.
- [ ] Release is NOT part of this plan — the user runs `bun run release` (0.7.0) themselves.
