# Dotimation Next Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every actionable finding from the post-merge review: SSR-safe first-paint sizing, settle-predicate dedup, web-font re-rasterization, `maxDpr`/`reducedMotion`/`fill`/`matching` props, an automated e2e suite in CI, changelog automation, and a full README/CLAUDE.md sync.

**Architecture:** Incremental additions to the existing pipeline. New pure modules (`morton.ts`) get unit tests; new DOM shells (`use-font-epoch`, ResizeObserver fill, e2e driver) are covered by the new e2e suite where headless-testable.

**Tech Stack:** React 19, TypeScript (isolatedDeclarations, noUncheckedIndexedAccess), Bun, Biome, Playwright (e2e only).

## Global Constraints

- Bun only: `bun test`, `bun run type-check`, `bun run lint:fix`. Never npm/yarn/pnpm.
- Biome style: single quotes, no semicolons, 2-space indent.
- `isolatedDeclarations` — explicit types on all exports; `noUncheckedIndexedAccess` — `arr[i]!` on hot paths.
- Comments only where the code cannot say it: constraints, non-obvious couplings, parity rules. No narration.
- Conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Cross-tier parity is sacred: reconcile must keep operating on **home-domain** values only (never simulated `x`/`y` of pre-existing live slots — stale under GPU tiers).
- Behavior defaults must be unchanged: `maxDpr` defaults to 2, `matching` to `'swarm'`, `fill` absent, `reducedMotion` absent (auto-detect) — a consumer upgrading sees no difference unless they opt in.

## Explicitly excluded (do not implement)

- **Coalescer cancellation** — a superseded rasterize wastes at most one bounded worker run; a cancel protocol costs more than it saves.
- **GPU control-flow unification** beyond `gpu-shared.ts` — revisit only if a third GPU tier appears.
- **`canvasRef` removal** — breaking; scheduled for the next major.
- **npm release & real-GPU verification** — user actions.

---

### Task 1: SSR-safe first-paint sizing

**Files:**
- Create: `src/utils/isomorphic-layout-effect.ts`
- Modify: `src/components/dotimation.tsx`

**Interfaces:**
- Produces: `export const useIsomorphicLayoutEffect: typeof useEffect` — `useLayoutEffect` in the browser, `useEffect` on the server (avoids React's SSR `useLayoutEffect` warning).
- The canvas JSX gains explicit CSS size via `style`, so server-rendered HTML reserves the correct box (no CLS) — `sizeCanvas` later writes the identical values, so there is no clobbering (the earlier clobber bug was the *attributes*, which reallocate the drawing buffer; CSS size does not).

- [ ] **Step 1: Create the isomorphic effect**

```ts
import { useEffect, useLayoutEffect } from 'react'

/**
 * useLayoutEffect warns under server rendering; the server branch runs no
 * effects anyway, so substituting useEffect is purely warning suppression.
 */
export const useIsomorphicLayoutEffect: typeof useEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
```

- [ ] **Step 2: Use it in the component**

In `src/components/dotimation.tsx`: replace the `useLayoutEffect` import/usage with `useIsomorphicLayoutEffect`, and give the canvas its CSS size in JSX (the `style` prop type already `Omit`s width/height, so consumers cannot conflict):

```tsx
      style={{ width: `${width}px`, height: `${height}px`, ...style }}
```

Update the sizing effect's comment: it owns the *backing store*; CSS size is now also declared in JSX so SSR HTML reserves the right box.

- [ ] **Step 3: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "fix: reserve correct CSS box at SSR/first paint; silence server useLayoutEffect"
```

---

### Task 2: Single settle predicate (`isSlotSettled`)

**Files:**
- Modify: `src/engine/rest.ts`, `src/backends/canvas2d/simulate.ts`

**Interfaces:**
- Produces: `export function isSlotSettled(field: ParticleField, i: number): boolean` in `rest.ts` — the per-slot predicate. `isFieldSettled` becomes a loop over it; `stepField` calls it instead of its inlined copy. The epsilon exports remain.

- [ ] **Step 1: Extract in rest.ts**

```ts
/** Per-slot convergence predicate; isFieldSettled and stepField share it. */
export function isSlotSettled(field: ParticleField, i: number): boolean {
  const { x, y, vx, vy, r, g, b, homeX, homeY, homeR, homeG, homeB, alpha, targetAlpha } = field
  if (vx[i]! * vx[i]! + vy[i]! * vy[i]! > VEL_EPS_SQ) return false
  if (Math.abs(x[i]! - homeX[i]!) > POS_EPS) return false
  if (Math.abs(y[i]! - homeY[i]!) > POS_EPS) return false
  if (targetAlpha[i]! > 0.5) {
    if (alpha[i]! < 1 - ALPHA_EPS) return false
  } else if (alpha[i]! > ALPHA_EPS) {
    return false
  }
  if (Math.abs(r[i]! - homeR[i]!) > COLOR_EPS) return false
  if (Math.abs(g[i]! - homeG[i]!) > COLOR_EPS) return false
  return Math.abs(b[i]! - homeB[i]!) <= COLOR_EPS
}

export function isFieldSettled(field: ParticleField): boolean {
  for (let i = 0; i < field.count; i++) {
    if (!isSlotSettled(field, i)) return false
  }
  return true
}
```

- [ ] **Step 2: Use it in stepField**

Replace the inlined predicate block in `src/backends/canvas2d/simulate.ts` with:

```ts
    if (settled && !isSlotSettled(field, i)) settled = false
```

(import `isSlotSettled`, drop the now-unused epsilon imports).

- [ ] **Step 3: Verify + commit**

Run: `bun test` (the existing cross-check test locks equivalence), `bun run type-check && bun run lint`

```bash
git add -A && git commit -m "refactor: single per-slot settle predicate shared by isFieldSettled and stepField"
```

---

### Task 3: Re-rasterize when web fonts finish loading

**Files:**
- Modify: `src/raster/worker-safe.ts` (export `isGenericFamily`)
- Create: `src/hooks/use-font-epoch.ts`
- Modify: `src/raster/inputs.ts` (`fontEpoch` input), `src/hooks/use-field-targets.ts`, `src/components/dotimation.tsx`
- Test: `test/raster/worker-safe.test.ts`, `test/raster/inputs.test.ts`

**Interfaces:**
- Produces: `export function isGenericFamily(family: string): boolean` (worker-safe.ts; `isWorkerSafe` reuses it).
- Produces: `export function useFontEpoch(item: AnimateItem, defaultFontFamily: string): number` — 0 initially; bumps once when a custom font that was *not yet loaded* at mount finishes loading, forcing one re-rasterization with real metrics.
- `RasterInputs` gains `fontEpoch: number`; `useFieldTargets` gains a trailing `fontEpoch` parameter.

Bug being fixed: text with a not-yet-loaded webfont rasterizes with fallback metrics and never corrects itself.

- [ ] **Step 1: TDD the pure part**

Add to `test/raster/worker-safe.test.ts`:

```ts
describe('isGenericFamily', () => {
  test('recognizes CSS generic families case-insensitively', () => {
    expect(isGenericFamily('sans-serif')).toBe(true)
    expect(isGenericFamily(' Monospace ')).toBe(true)
    expect(isGenericFamily('system-ui')).toBe(true)
  })
  test('rejects custom families', () => {
    expect(isGenericFamily('Inter')).toBe(false)
    expect(isGenericFamily('Inter, sans-serif')).toBe(false)
  })
})
```

Run to see it fail, then in `worker-safe.ts`:

```ts
/** True when `family` is a CSS generic (available in workers and never async-loaded). */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.trim().toLowerCase())
}
```

and use it inside `isWorkerSafe`.

- [ ] **Step 2: The hook**

```ts
import { useEffect, useState } from 'react'
import { isGenericFamily } from '@/raster/worker-safe'
import type { AnimateItem } from '@/types'

/**
 * Bumps once when the item's custom font finishes loading, so text first
 * rasterized with fallback metrics gets re-rasterized with the real ones.
 * Generic families never load asynchronously; 0 forever for those.
 */
export function useFontEpoch(
  item: AnimateItem,
  defaultFontFamily: string,
): number {
  const [epoch, setEpoch] = useState(0)
  const family =
    item.type === 'text' ? (item.fontFamily ?? defaultFontFamily) : null

  useEffect(() => {
    if (family === null || isGenericFamily(family)) return
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    try {
      if (document.fonts.check(`16px ${family}`)) return
    } catch {
      // Unparseable family string — nothing to wait for.
      return
    }
    document.fonts
      .load(`16px ${family}`)
      .then((faces) => {
        // load() resolves with [] when no matching @font-face exists; only a
        // real arrival warrants a re-raster.
        if (!cancelled && faces.length > 0) setEpoch((e) => e + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [family])

  return epoch
}
```

- [ ] **Step 3: Thread it through**

- `RasterInputs` gains `fontEpoch: number` (doc: "Bumped when the item's custom font finishes loading — see useFontEpoch"); `sameRasterInputs` compares it. Update `test/raster/inputs.test.ts` fixtures (add the field; add one case where only `fontEpoch` differs → not same).
- `useFieldTargets(..., dprEpoch, fontEpoch)` — new trailing param, included in the inputs object and the effect deps.
- Component: `const fontEpoch = useFontEpoch(item, defaultFontFamily)` passed as the new argument.

- [ ] **Step 4: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "fix: re-rasterize text once its custom web font finishes loading"
```

---

### Task 4: `maxDpr` prop

**Files:**
- Modify: `src/utils/utils.ts` (`getDpr(max)`, `sizeCanvas(..., dpr)`, `getCtx(..., dpr)`), `src/raster/rasterize.ts` (explicit `dpr` param), `src/hooks/use-field-targets.ts`, `src/raster/inputs.ts` (`maxDpr` input), `src/components/dotimation.tsx`
- Test: `test/utils/utils.test.ts`, `test/raster/inputs.test.ts`

**Interfaces:**
- `getDpr(max = 2): number` — cap becomes a parameter.
- `sizeCanvas(canvas, width, height, dpr = getDpr()): number` — takes the resolved dpr; callers with a custom cap compute it via `getDpr(maxDpr)`.
- `getCtx(canvas, width, height, dpr = getDpr())` — same.
- `rasterize(width, height, item, defaultFontFamily, alpha, pointSpacingCss, maxParticles, dpr)` — the main-thread rasterizer stops deriving dpr itself; `runRasterize` passes `getDpr(inputs.maxDpr)` to both paths.
- `RasterInputs` gains `maxDpr: number`; component prop `maxDpr?: number` (default 2). A `maxDpr` change is a density change → participates in the canvas key and engine-recreation deps exactly like `dprEpoch` (backend dot footprints bake dpr at init).

- [ ] **Step 1: TDD getDpr's cap parameter**

Add to `test/utils/utils.test.ts`:

```ts
  test('accepts a custom cap', () => {
    g.window = { devicePixelRatio: 3 }
    expect(getDpr(3)).toBe(3)
    expect(getDpr(1)).toBe(1)
  })
```

Fail → implement `export function getDpr(max = 2): number` → pass.

- [ ] **Step 2: Thread the dpr value**

- `sizeCanvas`/`getCtx`: add trailing `dpr: number = getDpr()` parameter; remove their internal `getDpr()` call bodies accordingly.
- `rasterize`: add trailing `dpr: number` (no default — both callers now supply it) and delete its internal `getDpr()`; `getCtx(canvas, width, height, dpr)`.
- `runRasterize` (use-field-targets): `const dpr = getDpr(inputs.maxDpr)`; pass to both `rasterizeViaWorker` (existing param) and `rasterize` (new param).
- `RasterInputs.maxDpr: number` + `sameRasterInputs` + inputs test fixtures.
- Component: prop `maxDpr = 2` with doc `/** Density cap for the canvas backing store. @default 2 */`; every `sizeCanvas(canvas, w, h)` call becomes `sizeCanvas(canvas, w, h, getDpr(maxDpr))`; add `maxDpr` to the canvas key, the layout-effect deps, the engine-creation deps, and the `useFieldTargets` call (as part of inputs).

- [ ] **Step 3: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "feat: maxDpr prop — configurable density cap (default unchanged at 2)"
```

---

### Task 5: `reducedMotion` prop override + playground toggle

**Files:**
- Modify: `src/components/dotimation.tsx`
- Modify: `test/ui/src/config/*` and the Inspector component (read them first; follow their existing control pattern)

**Interfaces:**
- Component prop `reducedMotion?: boolean` — `undefined` = follow the OS media query (current behavior); `true`/`false` forces it. Doc: apps with their own motion setting pass it here.
- Implementation: `const reduced = reducedMotion ?? systemReducedMotion` where `systemReducedMotion = useReducedMotion()`; every existing use of the old `reducedMotion` state (key, deps, jitter, snap ref) switches to `reduced`.
- Playground: a `reducedMotion` boolean in the config store + an Inspector toggle (same switch component as `invert`/`cap dots`), passed to `<Dotimation reducedMotion={...}>` — makes the snap path manually testable without OS settings.

- [ ] **Step 1: Component override** — add the prop, rename the derived value to `reduced`, update key/deps/jitter/ref.
- [ ] **Step 2: Playground toggle** — read `test/ui/src/config/use-config.ts` + the inspector sections; add the toggle following the exact local pattern; wire through the Stage's `<Dotimation>`.
- [ ] **Step 3: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "feat: reducedMotion prop override + playground toggle"
```

---

### Task 6: `fill` sizing mode

**Files:**
- Modify: `src/components/dotimation.tsx`, `src/hooks/use-field-targets.ts`

**Interfaces:**
- Props become a union on sizing:

```ts
type SizeProps =
  | { width: number; height: number; fill?: false }
  | { fill: true; width?: undefined; height?: undefined }
```

merged into `DotimationProps` (keep every other prop shared). With `fill`, the canvas is styled `width/height: 100%` and its CSS content box is tracked with a `ResizeObserver`; the observed size feeds the entire existing pipeline as `width`/`height`.
- `useFieldTargets`: non-positive `width`/`height` publish `emptyFieldTargets()` (the observer hasn't reported yet) instead of rasterizing a 0×0 canvas.

- [ ] **Step 1: Guard the hook** — in the effect, extend the empty-item branch: `if (!item.data || width <= 0 || height <= 0)` → `setTargets(emptyFieldTargets())`.

- [ ] **Step 2: Component**

```tsx
  const fill = props.fill === true
  const [observed, setObserved] = useState<{ w: number; h: number } | null>(null)
  const width = fill ? (observed?.w ?? 0) : props.width
  const height = fill ? (observed?.h ?? 0) : props.height
```

ResizeObserver effect (deps mirror the layout effect's key-participating values so a remounted canvas is re-observed):

```tsx
  useEffect(() => {
    if (!fill) return
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      setObserved((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [fill, backend, dprEpoch, reduced, maxDpr])
```

Style: `fill ? { width: '100%', height: '100%', ...style } : { width: `${width}px`, height: `${height}px`, ...style }`. Everything downstream (layout effect, raster inputs, engine resize) already keys off the derived `width`/`height`.

- [ ] **Step 3: Playground sanity** — the Stage's "Fill" size button should exercise this naturally if it maps to the prop; otherwise leave playground unchanged (e2e covers fixed sizing).
- [ ] **Step 4: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "feat: fill mode — parent-driven sizing via ResizeObserver"
```

---

### Task 7: `matching: 'nearest'` morphs (spatial pairing)

**Files:**
- Create: `src/engine/morton.ts`
- Modify: `src/engine/field.ts` (`reconcile` options, generalized `retargetActive`), `src/components/dotimation.tsx`
- Test: `test/engine/morton.test.ts`, `test/engine/reconcile.test.ts`

**Interfaces:**
- `export function morton16(x: number, y: number): number` — 32-bit Morton code from two 16-bit ints.
- `export function spatialOrder(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): Uint32Array` — indices `[0, count)` sorted by Morton code of rounded coords. Pure, deterministic.
- `reconcile(field, targets, opts?: { matching?: 'index' | 'spatial' })` — `'index'` (default) is today's behavior. `'spatial'` pairs the rank-`r` slot (by Morton order of its **home-domain** position) with the rank-`r` target (by Morton order of its home), producing locally-coherent "nearest-ish" morphs in O(n log n).
- Component prop `matching?: 'swarm' | 'nearest'` (default `'swarm'`), read through a ref at reconcile time (applies from the next content change).
- **Parity constraint:** slot ordering keys must be home-domain — `homeX/homeY` for pre-existing slots (`i < prevActive`), the just-written spawn position `x/y` for spawn slots (also a home value). Never simulated positions.

- [ ] **Step 1: TDD morton**

```ts
import { describe, expect, test } from 'bun:test'
import { morton16, spatialOrder } from '@/engine/morton'

describe('morton16', () => {
  test('interleaves bits (x low bit -> bit 0, y low bit -> bit 1)', () => {
    expect(morton16(0, 0)).toBe(0)
    expect(morton16(1, 0)).toBe(1)
    expect(morton16(0, 1)).toBe(2)
    expect(morton16(1, 1)).toBe(3)
    expect(morton16(0b11, 0b11)).toBe(0b1111)
  })
})

describe('spatialOrder', () => {
  test('orders spatial neighbors adjacently and is deterministic', () => {
    const xs = [100, 0, 101, 1]
    const ys = [100, 0, 100, 0]
    const order = Array.from(spatialOrder(xs, ys, 4))
    // The two origin-corner points and the two far-corner points end up adjacent.
    expect(order.slice(0, 2).sort()).toEqual([1, 3])
    expect(order.slice(2).sort()).toEqual([0, 2])
  })
})
```

Fail → implement:

```ts
/** Interleaves the low 16 bits of x and y into a 32-bit Morton (Z-order) code. */
export function morton16(x: number, y: number): number {
  let a = x & 0xffff
  let b = y & 0xffff
  a = (a | (a << 8)) & 0x00ff00ff
  a = (a | (a << 4)) & 0x0f0f0f0f
  a = (a | (a << 2)) & 0x33333333
  a = (a | (a << 1)) & 0x55555555
  b = (b | (b << 8)) & 0x00ff00ff
  b = (b | (b << 4)) & 0x0f0f0f0f
  b = (b | (b << 2)) & 0x33333333
  b = (b | (b << 1)) & 0x55555555
  return (a | (b << 1)) >>> 0
}

/** Indices [0, count) sorted by Morton code of the rounded coordinates. */
export function spatialOrder(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
): Uint32Array {
  const codes = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    codes[i] = morton16(Math.round(xs[i]!), Math.round(ys[i]!))
  }
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  return order.sort((a, b) => codes[a]! - codes[b]! || a - b)
}
```

- [ ] **Step 2: TDD reconcile's spatial mode**

Add to `test/engine/reconcile.test.ts` (adapting to its fixtures):

```ts
test('spatial matching pairs each particle with its nearby target', () => {
  // Two clusters far apart; targets list the SAME positions in reversed order.
  // Index matching would send both particles across the canvas; spatial
  // matching keeps each at (approximately) its own position.
  const a = targetsOf([{ x: 0, y: 0 }, { x: 500, y: 500 }])
  const b = targetsOf([{ x: 500, y: 500 }, { x: 0, y: 0 }]) // reversed
  let f = reconcile(createField(2), a)
  f = reconcile(f, b, { matching: 'spatial' })
  // Each slot's new home equals its old home — zero travel.
  expect([f.homeX[0], f.homeY[0]]).toEqual([0, 0])
  expect([f.homeX[1], f.homeY[1]]).toEqual([500, 500])
})

test('index matching (default) is unchanged', () => {
  const a = targetsOf([{ x: 0, y: 0 }, { x: 500, y: 500 }])
  const b = targetsOf([{ x: 500, y: 500 }, { x: 0, y: 0 }])
  let f = reconcile(createField(2), a)
  f = reconcile(f, b)
  expect([f.homeX[0], f.homeY[0]]).toEqual([500, 500])
})
```

(write `targetsOf` per the file's existing FieldTargets helpers.)

- [ ] **Step 3: Implement in field.ts**

Generalize the retarget to take a target index, and derive the pairing:

```ts
export interface ReconcileOptions {
  /** 'index' pairs slot i with target i (swarm look); 'spatial' pairs by Morton rank for locally-coherent morphs. */
  matching?: 'index' | 'spatial'
}

function retargetActive(
  field: ParticleField,
  slot: number,
  t: FieldTargets,
  target: number,
): void {
  field.homeX[slot] = t.homeX[target]!
  field.homeY[slot] = t.homeY[target]!
  field.homeR[slot] = t.homeR[target]!
  field.homeG[slot] = t.homeG[target]!
  field.homeB[slot] = t.homeB[target]!
  field.targetAlpha[slot] = 1
}
```

In `reconcile(field, targets, opts: ReconcileOptions = {})`: keep the firstLoad and spawn phases untouched (firstLoad calls `retargetActive(f, i, targets, i)` — order is meaningless on a blank field). Replace the retarget loop:

```ts
  if (opts.matching === 'spatial' && plan.active > 1) {
    // Ordering keys must be home-domain (parity rule): pre-existing slots use
    // their outgoing homes; spawn slots use the spawn position just written to
    // x/y (itself a home value, never simulated).
    const prevActive = field.active
    const kx = new Float32Array(plan.active)
    const ky = new Float32Array(plan.active)
    for (let i = 0; i < plan.active; i++) {
      if (i < prevActive) {
        kx[i] = f.homeX[i]!
        ky[i] = f.homeY[i]!
      } else {
        kx[i] = f.x[i]!
        ky[i] = f.y[i]!
      }
    }
    const slotOrder = spatialOrder(kx, ky, plan.active)
    const targetOrder = spatialOrder(targets.homeX, targets.homeY, plan.active)
    for (let r = 0; r < plan.active; r++) {
      retargetActive(f, slotOrder[r]!, targets, targetOrder[r]!)
    }
  } else {
    for (let i = 0; i < plan.active; i++) retargetActive(f, i, targets, i)
  }
```

**Careful:** `prevActive` must be captured from the ORIGINAL `field.active` before `f.active` is assigned (it already is — the assignment happens at the end; use the same `field.active` read the spawn block uses).

- [ ] **Step 4: Component prop**

`matching?: 'swarm' | 'nearest'` (default `'swarm'`), doc: `'nearest'` produces calmer, locally-coherent morphs. Read via a ref (like `dotSizeRef`); both reconcile call sites become:

```tsx
    reconcile(fieldRef.current, targets, {
      matching: matchingRef.current === 'nearest' ? 'spatial' : 'index',
    })
```

- [ ] **Step 5: Verify + commit**

Run: `bun test && bun run type-check && bun run lint`

```bash
git add -A && git commit -m "feat: matching='nearest' — Morton-rank spatial pairing for coherent morphs"
```

---

### Task 8: E2E suite in-repo + CI job

**Files:**
- Create: `test/e2e/smoke.e2e.ts`
- Modify: `package.json` (devDep `playwright`, script `test:e2e`), `.github/workflows/ci.yml` (new `e2e` job)

**Interfaces:**
- `bun run test:e2e` — self-contained: starts Vite (`--port 5273 --strictPort`, cwd `test/ui`), drives headless Chromium via `playwright`'s own binary resolution, asserts, kills the server, exits non-zero on any failure. Named `.e2e.ts` so `bun test` does NOT pick it up.
- Assertions:
  1. auto backend resolves (stats text matches `webgpu|webgl2|canvas2d`), zero console errors
  2. canvas has `role="img"`, non-empty `aria-label`, buffer = CSS size × dpr
  3. switch to the `2D` backend (Inspector button) → pixel-probe via `drawImage` (2d canvases are readable) → painted pixels > 100
  4. `page.emulateMedia({ reducedMotion: 'reduce' })` + reload → 2D backend → still > 100 painted pixels (the snap path renders)
  5. Space swap mid-run → no console errors
- CI: an `e2e` job on `ubuntu-latest` — `bun install`, `bunx playwright install --with-deps chromium`, `bun run test:e2e` — separate from the OS test matrix.

- [ ] **Step 1: Add the dependency and script** — `bun add -d playwright`; `"test:e2e": "bun test/e2e/smoke.e2e.ts"`.
- [ ] **Step 2: Write the driver** — adapt the session's proven scratchpad script: `Bun.spawn` for Vite with `--strictPort`, poll `http://localhost:5273` with fetch (30 s timeout), `chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })` using playwright's default executable, the five assertions above as small `check(name, fn)` helpers that collect failures, `finally` block kills the Vite process. Locally run `bunx playwright install chromium` once if launch fails on a missing browser.
- [ ] **Step 3: CI job** — read `.github/workflows/ci.yml`, append the `e2e` job following the file's existing setup steps (bun setup action, install).
- [ ] **Step 4: Verify** — `bun run test:e2e` passes locally; `bun test` still runs only unit tests.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: in-repo e2e smoke suite (backends, a11y, sizing, reduced motion) + CI job"
```

---

### Task 9: Changelog automation on release

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- After the npm publish step, `bunx changelogithub` generates a GitHub Release with grouped conventional-commit notes for the pushed `v*` tag. Needs `GITHUB_TOKEN` env and `contents: write` permission on the job.

- [ ] **Step 1:** Read `release.yml`; add (adjusting to its structure):

```yaml
      - name: Generate GitHub release notes
        run: bunx changelogithub
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

and ensure the job has `permissions: contents: write`.

- [ ] **Step 2: Verify + commit** — workflow YAML lints by inspection (it only runs on tags); `bun run lint` for the repo.

```bash
git add -A && git commit -m "ci: generate GitHub release notes from conventional commits on tag push"
```

---

### Task 10: README + CLAUDE.md sync (documents the FINAL API)

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README props table** — rewrite to cover the complete API with correct semantics:
  - fix `dotSize`: "Dot footprint in CSS px (a `dotSize`×`dotSize` square, scaled to device pixels)" — not "radius multiplier"
  - add `ref` (canvas element), `canvasRef` (marked deprecated), `ariaLabel`, `className`, `style`, `maxDpr`, `matching` (`'swarm' | 'nearest'` with one-line visual description), `reducedMotion`, `fill` (with a short example block showing the fill-mode union: either `width`+`height` or `fill`)
- [ ] **Step 2: README prose sections** — add short sections: **Accessibility** (`role="img"`, default label, supplying `ariaLabel` for images), **Reduced motion** (auto-detected; override prop), **Rendering backends** (auto cascade order; explicit request keeps lower tiers as fallback).
- [ ] **Step 3: CLAUDE.md** — sync: `morton.ts` + spatial matching (and its home-domain parity rule), `use-font-epoch`, `fill` mode observer, `maxDpr` threading (dpr is now passed into `sizeCanvas`/`getCtx`/`rasterize` explicitly), `isSlotSettled`, e2e suite (`bun run test:e2e`, what it covers, the `.e2e.ts` naming rule), changelogithub.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: full README/CLAUDE.md sync for the new API surface"
```

---

### Task 11: Final verification

- [ ] `bun install && bun run build && bun run type-check && bun run lint && bun test && bun run test:e2e` — all green.
- [ ] `dist/index.js` is non-trivial (>1 KB) and code-split chunks exist (guard against the sideEffects-style bundler regression).
- [ ] Commit any stragglers; hand off via superpowers:finishing-a-development-branch.
