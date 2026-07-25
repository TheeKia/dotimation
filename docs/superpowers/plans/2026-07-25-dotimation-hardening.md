# Dotimation Hardening & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 19 findings from the 2026-07-25 codebase review — correctness (dotSize semantics, canvas sizing, font overflow), performance (raster coalescing, image caching, dead reconcile work, preserveDrawingBuffer, O(1) settled), structure (GPU dedup, dead code, DPR helper, setIdle, cascade), and polish (a11y, reduced motion, React 19 ref, GPU hash, sideEffects).

**Architecture:** Incremental refactor of the existing particle pipeline. No new subsystems; each task is an isolated, independently committable change. Pure logic gets unit tests under `bun test`; DOM/GPU shells stay playground-verified.

**Tech Stack:** React 19, TypeScript (isolatedDeclarations, noUncheckedIndexedAccess), Bun toolchain, Biome, WebGL2/WebGPU/Canvas2D.

## Global Constraints

- Bun is the only toolchain: `bun test`, `bun run type-check`, `bun run lint:fix`. Never npm/yarn/pnpm.
- Biome style: single quotes, no semicolons, 2-space indent. Run `bun run lint:fix` before each commit.
- `isolatedDeclarations: true` — every exported symbol needs an explicit return/const type annotation when not a literal.
- `noUncheckedIndexedAccess: true` — use `arr[i]!` non-null assertions on hot-path index access (deliberate convention).
- Tests live in `test/` mirroring `src/`, use `import { describe, expect, test } from 'bun:test'` and the `@/` alias.
- Pre-commit hook runs `lint` + `type-check` automatically; a failing hook means fix before committing.
- Commit messages: conventional commits (`fix:`, `feat:`, `refactor:`, `perf:`, `test:`, `chore:`), ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Cross-tier parity is sacred: any visual-math change (dot size, jitter, blending) must be applied identically to canvas2d, webgl2, and webgpu.
- CSS-pixel positions / device-pixel backing store; `dpr = min(devicePixelRatio, 2)`.

---

### Task 1: Delete dead code (`resolveBackendKind`, `viewport.ts`)

**Files:**
- Modify: `src/engine/backend.ts` (remove `resolveBackendKind`, keep `Capabilities` + `detectCapabilities`)
- Delete: `src/engine/viewport.ts`
- Delete: `test/engine/backend.test.ts`
- Delete: `test/engine/viewport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — pure deletion. `Capabilities` and `detectCapabilities` in `src/engine/backend.ts` must remain (used by `select.ts`).

Rationale: `resolveBackendKind` was superseded by `resolveBackendOrder` (`src/engine/cascade.ts`) and is only referenced by its own test. `viewport.ts` (`cssToClipX/Y`) is a "shader mirror" only its own test imports, and it has drifted — the real shaders snap with `floor(pos * dpr + 0.5)`, which the mirror omits. Test-only mirrors that drift are worse than nothing.

- [ ] **Step 1: Remove `resolveBackendKind` from `src/engine/backend.ts`**

Delete the function and its doc comment (lines 8–17). The file keeps `Capabilities` and `detectCapabilities`. Remove the now-unused `import type { BackendKind }` if nothing else references it (after removal, `BackendKind` is unused in this file — delete the import).

- [ ] **Step 2: Delete the dead files**

```bash
rm src/engine/viewport.ts test/engine/viewport.test.ts test/engine/backend.test.ts
```

- [ ] **Step 3: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: all pass, no unresolved imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete dead resolveBackendKind and drifted viewport shader mirror"
```

---

### Task 2: Single-source DPR (`getDpr`) and idempotent `sizeCanvas`

**Files:**
- Modify: `src/utils/utils.ts`
- Modify: `src/hooks/use-field-targets.ts` (use `getDpr`)
- Modify: `src/raster/rasterize.ts` (use `getDpr`)
- Test: `test/utils/utils.test.ts` (create)

**Interfaces:**
- Produces: `export function getDpr(): number` in `src/utils/utils.ts` — returns `Math.min(window.devicePixelRatio || 1, 2)`, guarding `typeof window === 'undefined'` → 1.
- Produces: `sizeCanvas(canvas, width, height): number` keeps its signature but becomes a no-op when the canvas is already at the target size (setting `canvas.width` to the *same* value still clears the canvas, so the guard is a correctness fix, not just perf). Task 3 relies on this idempotence.
- `getCtx` delegates its sizing to `sizeCanvas`.

- [ ] **Step 1: Write failing tests**

Create `test/utils/utils.test.ts`. `bun test` runs without a DOM by default, so test the pure part: `getDpr`'s SSR guard and cap. Use `happy-dom`? No — keep it DOM-free: test `getDpr` via a temporary `globalThis.window` stub.

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { getDpr } from '@/utils/utils'

const g = globalThis as { window?: { devicePixelRatio?: number } }

afterEach(() => {
  delete g.window
})

describe('getDpr', () => {
  test('returns 1 outside a browser', () => {
    expect(getDpr()).toBe(1)
  })

  test('caps devicePixelRatio at 2', () => {
    g.window = { devicePixelRatio: 3 }
    expect(getDpr()).toBe(2)
  })

  test('defaults a missing ratio to 1', () => {
    g.window = {}
    expect(getDpr()).toBe(1)
  })

  test('passes through ratios below the cap', () => {
    g.window = { devicePixelRatio: 1.5 }
    expect(getDpr()).toBe(1.5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/utils/utils.test.ts`
Expected: FAIL — `getDpr` is not exported.

- [ ] **Step 3: Implement**

In `src/utils/utils.ts`:

```ts
/** Device pixel ratio, capped at 2 (the library-wide density policy). 1 outside a browser. */
export function getDpr(): number {
  if (typeof window === 'undefined') return 1
  return Math.min(window.devicePixelRatio || 1, 2)
}

/**
 * Sizes a canvas's drawing buffer to device pixels and its CSS box to logical
 * pixels, WITHOUT acquiring a rendering context — so the caller's backend is
 * free to take either a '2d' or 'webgl2' context. Idempotent: setting
 * canvas.width to even the SAME value clears the canvas, so every assignment
 * is guarded. Returns the dpr used.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): number {
  const dpr = getDpr()
  const devW = Math.round(width * dpr)
  const devH = Math.round(height * dpr)
  if (canvas.width !== devW) canvas.width = devW
  if (canvas.height !== devH) canvas.height = devH
  const cssW = `${width}px`
  const cssH = `${height}px`
  if (canvas.style.width !== cssW) canvas.style.width = cssW
  if (canvas.style.height !== cssH) canvas.style.height = cssH
  return dpr
}

export function getCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = sizeCanvas(canvas, width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  return ctx
}
```

Replace the two inline `Math.min(window.devicePixelRatio || 1, 2)` reads:
- `src/hooks/use-field-targets.ts:48` → `const dpr = getDpr()` (import from `@/utils/utils`)
- `src/raster/rasterize.ts:33` → `const dpr = getDpr()` (import `getDpr` alongside `getCtx`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: single-source the DPR policy and make sizeCanvas idempotent"
```

---

### Task 3: Stop the JSX `width`/`height` attrs fighting `sizeCanvas`

**Files:**
- Modify: `src/components/dotimation.tsx`

**Interfaces:**
- Consumes: idempotent `sizeCanvas` from Task 2.
- Produces: the canvas element no longer carries `width`/`height` JSX attributes; sizing is owned exclusively by a `useLayoutEffect` (pre-paint) that also notifies the live engine.

Rationale: React committing `width={width}` (CSS px) reallocates + clears the canvas at the wrong size on every size change; the resize effect then reallocates again at device px. Two clears + one guaranteed-blank frame per resize step. Owning sizing in one pre-paint layout effect removes both.

- [ ] **Step 1: Replace the resize effect and JSX attrs**

In `src/components/dotimation.tsx`:

1. Add `useLayoutEffect` to the React import.
2. Replace the existing live-resize `useEffect` (`[width, height]`) with a `useLayoutEffect` placed **before** the engine-creation effect:

```tsx
  // Size the canvas before paint. This is the ONLY place the canvas backing
  // store is sized (the JSX deliberately carries no width/height attributes —
  // React re-committing them in CSS px would clear the canvas at the wrong
  // size on every resize). Also notifies the live engine, in place, so
  // simulation state survives (the morph continues instead of restarting).
  // biome-ignore lint/correctness/useExhaustiveDependencies(backend): a backend change remounts the canvas (see the key), and the fresh element must be sized again
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): sizeCanvas reads devicePixelRatio, which changed exactly when dprEpoch was bumped
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const prevW = canvas.width
    const prevH = canvas.height
    sizeCanvas(canvas, width, height)
    if (canvas.width !== prevW || canvas.height !== prevH) {
      engineRef.current?.resize(canvas.width, canvas.height)
    }
  }, [width, height, backend, dprEpoch])
```

3. Remove `width={width}` and `height={height}` from the `<canvas>` JSX (keep `key`, `ref`, `className`, `style`).
4. The engine-creation effect keeps its `sizeCanvas` call (now a cheap no-op that returns the dpr) and its post-async size catch-up block — both still correct.

- [ ] **Step 2: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS. (Visual behavior is playground-verified at the end of the plan.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: own canvas sizing in one pre-paint layout effect, drop JSX width/height"
```

---

### Task 4: Remove dead `copySlot` work from reconcile's spawn path

**Files:**
- Modify: `src/engine/field.ts`

**Interfaces:**
- Consumes/Produces: `reconcile(field, targets)` behavior is unchanged (observable state identical); `copySlot` and `ARRAY_KEYS`'s only non-`growField` use are deleted.

Rationale: in the spawn loop, `copySlot(f, src, i)` copies all 14 arrays, but every one is subsequently overwritten — `x/y/vx/vy/r/g/b/alpha` explicitly in the spawn loop, and `homeX/homeY/homeR/homeG/homeB/targetAlpha` by `retargetActive` (spawned slots are all `< plan.active`). Verified exhaustively against `ARRAY_KEYS`.

- [ ] **Step 1: Confirm the existing tests cover spawn**

Run: `bun test test/engine/field.test.ts test/engine/reconcile.test.ts`
Expected: PASS (baseline). These tests assert post-reconcile observable state, so they lock the behavior this refactor must preserve.

- [ ] **Step 2: Delete the dead copy**

In `src/engine/field.ts`, delete the `copySlot` function and simplify the spawn loop — the two branches differed only in where they read the seed values from:

```ts
  if (plan.spawn) {
    const prevActive = field.active
    for (let i = plan.spawn.start; i < plan.spawn.end; i++) {
      if (prevActive > 0) {
        // Spawn at a live particle's HOME, not its live position: under GPU
        // backends the CPU field's x/y are stale (the sim runs on the GPU),
        // while homes are authoritative on every tier and equal the live
        // position once the field has settled. Homes/targetAlpha for this
        // slot are set by retargetActive below (every spawned slot is
        // < plan.active), so nothing else needs copying from src.
        const src = i % prevActive
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

- [ ] **Step 3: Verify behavior is unchanged**

Run: `bun test`
Expected: PASS — identical observable state.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "perf: drop fully-overwritten copySlot from reconcile spawn path"
```

---

### Task 5: Extract shared GPU-backend module (`gpu-shared.ts`)

**Files:**
- Create: `src/backends/gpu-shared.ts`
- Modify: `src/engine/reconcile-plan.ts` (remove `STATE_FLOATS`/`TARGET_FLOATS`)
- Modify: `src/backends/webgl2/buffers.ts`, `src/backends/webgl2/index.ts`, `src/backends/webgl2/program-sim.ts`, `src/backends/webgl2/program-draw.ts`
- Modify: `src/backends/webgpu/buffers.ts`, `src/backends/webgpu/index.ts`, `src/backends/webgpu/pipelines.ts`
- Test: `test/backends/gpu-shared.test.ts` (move/extend `test/backends/webgl2/buffers.test.ts`)

**Interfaces:**
- Produces (all from `src/backends/gpu-shared.ts`):
  - `export const STATE_FLOATS = 8` / `export const TARGET_FLOATS = 6` (moved out of `reconcile-plan.ts` — GPU buffer layout does not belong in the pure CPU planner)
  - `export const STATE_STRIDE_BYTES: number = STATE_FLOATS * 4`
  - `export const QUAD: Float32Array` (the unit triangle-strip quad, currently duplicated)
  - `export function packStateInto(out: Float32Array, field: ParticleField, start: number, end: number): Float32Array` (verbatim from the two identical copies)
  - `export function packTargetsInto(out: Float32Array, field: ParticleField, count: number): Float32Array` (verbatim)
  - `export const FADE_DURATION_MS: number = (1 / OPACITY_RATE + 0.15) * 1000` (currently duplicated in both GPU index files)
  - `export function ensureScratch(scratch: Float32Array, floats: number): Float32Array` — returns `scratch` if big enough, else a new `Float32Array(floats)`
- Consumers: both GPU backends import everything above; `reconcile-plan.ts` keeps only `FieldDelta` + `planReconcile`.

- [ ] **Step 1: Move the buffers test and write scratch tests**

`git mv test/backends/webgl2/buffers.test.ts test/backends/gpu-shared.test.ts`, update its imports to `@/backends/gpu-shared`, and add:

```ts
describe('ensureScratch', () => {
  test('returns the same array when already large enough', () => {
    const s = new Float32Array(16)
    expect(ensureScratch(s, 8)).toBe(s)
    expect(ensureScratch(s, 16)).toBe(s)
  })

  test('allocates a larger array when too small', () => {
    const s = new Float32Array(8)
    const next = ensureScratch(s, 9)
    expect(next).not.toBe(s)
    expect(next.length).toBe(9)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/backends/gpu-shared.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/backends/gpu-shared.ts`**

```ts
import { OPACITY_RATE } from '@/engine/constants'
import type { ParticleField } from '@/types'

/**
 * Interleaved GPU buffer layout + packing shared by the WebGL2 and WebGPU
 * backends. Both tiers upload the same [x,y,vx,vy,r,g,b,alpha] state stride
 * and [homeX,homeY,homeR,homeG,homeB,targetAlpha] target stride, so the
 * layout constants and packers live here — a single source the tiers cannot
 * drift from.
 */
export const STATE_FLOATS = 8
export const TARGET_FLOATS = 6
export const STATE_STRIDE_BYTES: number = STATE_FLOATS * 4

/** Unit quad as a triangle strip (4 corners in [0,1]). */
export const QUAD: Float32Array = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

/**
 * Faders fade out at OPACITY_RATE; after this long they are invisible and the
 * tail can be dropped. The Canvas2D backend compacts faders in stepField; the
 * GPU sims don't change count, so the backends expire them by elapsed time.
 */
export const FADE_DURATION_MS: number = (1 / OPACITY_RATE + 0.15) * 1000

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

/** Returns `scratch` when it can hold `floats`, else a fresh larger array. */
export function ensureScratch(
  scratch: Float32Array,
  floats: number,
): Float32Array {
  return scratch.length >= floats ? scratch : new Float32Array(floats)
}
```

- [ ] **Step 4: Rewire every consumer**

- `src/engine/reconcile-plan.ts`: delete `STATE_FLOATS`/`TARGET_FLOATS` exports (keep `FieldDelta`, `planReconcile`).
- `src/backends/webgl2/buffers.ts` and `src/backends/webgpu/buffers.ts`: delete their local `QUAD`, `packStateInto`, `packTargetsInto`; import `QUAD`, `STATE_FLOATS`, `TARGET_FLOATS` from `../gpu-shared`; re-export nothing (consumers import packers from `gpu-shared` directly).
- `src/backends/webgl2/index.ts` / `src/backends/webgpu/index.ts`: import `packStateInto`, `packTargetsInto`, `STATE_FLOATS`, `TARGET_FLOATS`, `STATE_STRIDE_BYTES`, `FADE_DURATION_MS`, `ensureScratch` from `../gpu-shared`; delete the local `STATE_STRIDE_BYTES` and `FADE_DURATION_MS`; replace the two scratch-growth `if` blocks in each `ensureCapacity` with:

```ts
    stateScratch = ensureScratch(stateScratch, next.capacity * STATE_FLOATS)
    targetScratch = ensureScratch(targetScratch, next.capacity * TARGET_FLOATS)
```

- `src/backends/webgl2/program-sim.ts`, `src/backends/webgl2/program-draw.ts`, `src/backends/webgpu/pipelines.ts`: import `STATE_FLOATS`/`TARGET_FLOATS` from the new module instead of `@/engine/reconcile-plan`.

- [ ] **Step 5: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: extract shared GPU layout/packing/fade module, slim reconcile-plan to the pure planner"
```

---

### Task 6: `dotSize` means CSS pixels on every tier

**Files:**
- Modify: `src/backends/canvas2d/render.ts` (footprint = `max(1, round(dotSize * dpr))`)
- Modify: `src/backends/webgl2/shaders/draw.vert.ts`, `src/backends/webgpu/shaders/draw.wgsl.ts`
- Modify: `src/types.ts`, `src/components/dotimation.tsx` (doc comments)
- Test: `test/backends/canvas2d/render.test.ts`

**Interfaces:**
- Produces: `dotSize` is now resolution-independent. Device footprint on every tier = `max(1, round(dotSize * dpr))`, computed identically in JS (`Math.round`) and shaders (`floor(x + 0.5)`).

Rationale: `src/types.ts` documents CSS px, all three implementations used raw device px — dots rendered half-size on dpr-2 displays while `pointSpacingCss` stayed CSS-anchored. Behavior change is intentional and cross-tier identical.

- [ ] **Step 1: Write the failing test**

In `test/backends/canvas2d/render.test.ts`, add (adapting to the file's existing helpers for building fields/views):

```ts
describe('dotSize is CSS px', () => {
  test('dotSize 1 at dpr 2 paints a 2x2 device-pixel footprint', () => {
    const f = createField(1)
    f.count = 1
    f.active = 1
    f.x[0] = 1
    f.y[0] = 1
    f.r[0] = 255
    f.alpha[0] = 1
    const view = new Uint32Array(16) // 4x4 device px
    renderField(view, f, 4, 4, 2, 1)
    const painted = view.reduce((n, p) => n + (p !== 0 ? 1 : 0), 0)
    expect(painted).toBe(4)
  })
})
```

Also review existing render tests: any that pass `dpr !== 1` with a `dotSize` now scales differently — update their expected footprints to `round(dotSize * dpr)`.

- [ ] **Step 2: Run to verify the new test fails**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: FAIL — footprint is 1 device px today.

- [ ] **Step 3: Implement on all three tiers**

`src/backends/canvas2d/render.ts` — in BOTH `computeDirtyRect` and `renderField`, change:

```ts
  const size = Math.max(1, Math.round(dotSize * dpr))
```

`src/backends/webgl2/shaders/draw.vert.ts` — the uniform stays CSS px; derive the device footprint in the shader so JS and GPU round identically:

```glsl
uniform float uDotSize; // dot footprint in CSS px (converted to device px here)
...
void main() {
  float sizeDev = max(1.0, floor(uDotSize * uDpr + 0.5));
  vec2 dev = floor(aInstancePos * uDpr + 0.5) + aCorner * sizeDev;
  ...
```

`src/backends/webgpu/shaders/draw.wgsl.ts` — same math:

```wgsl
  let sizeDev = max(1.0, floor(R.dotSize * R.dpr + 0.5));
  let dev = floor(instPos * R.dpr + vec2<f32>(0.5, 0.5)) + corner * sizeDev;
```

Docs: `src/types.ts` `setDotSize` comment stays "(in CSS px)" — now true. `src/components/dotimation.tsx` prop doc becomes:

```ts
  /** Dot footprint in CSS px (scales with devicePixelRatio). @default 1 */
  dotSize?: number
```

- [ ] **Step 4: Verify**

Run: `bun test && bun run type-check`
Expected: PASS including updated render tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: make dotSize CSS-px on all tiers so dots render the same size at every DPR"
```

---

### Task 7: Auto font sizing respects height (no vertical clipping) + font tests

**Files:**
- Modify: `src/raster/draw.ts` (`resolveFontSize` gains `height`)
- Modify: `src/raster/raster.worker.ts` — no change needed (`drawText` computes internally), verify only
- Test: `test/utils/font.test.ts` (create), `test/raster/draw.test.ts` (create)

**Interfaces:**
- Produces: `export function resolveFontSize(item: Extract<AnimateItem, { type: 'text' }>, width: number, height: number): number`. AUTO/AUTO_MONO results are clamped so `lines * fontSize * 1.2 <= height` (floored at the heuristics' MIN of 10). An explicit numeric `fontSize` is respected verbatim — the user asked for it.
- Consumes: `getAutoFontSize`/`getMonospaceFontSize` from `src/utils/font.ts` (unchanged).
- `drawText` passes its `height` through.

- [ ] **Step 1: Write characterization tests for font.ts (currently untested)**

Create `test/utils/font.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'

describe('getAutoFontSize', () => {
  test('clamps to the 10..300 range', () => {
    expect(getAutoFontSize(1, 'some long line of text')).toBe(10)
    expect(getAutoFontSize(1_000_000, 'hi')).toBe(300)
  })

  test('returns MIN for empty or invalid input', () => {
    expect(getAutoFontSize(500, '')).toBe(10)
    expect(getAutoFontSize(0, 'text')).toBe(10)
    expect(getAutoFontSize(Number.POSITIVE_INFINITY, 'text')).toBe(10)
  })

  test('longer lines get smaller fonts at the same width', () => {
    const short = getAutoFontSize(500, 'hello')
    const long = getAutoFontSize(500, 'hello world, a much longer line')
    expect(long).toBeLessThan(short)
  })

  test('uses the widest line of multiline text', () => {
    const multi = getAutoFontSize(500, 'hi\na considerably longer line here')
    const widest = getAutoFontSize(500, 'a considerably longer line here')
    expect(multi).toBe(widest)
  })

  test('wide glyphs (CJK) cost more than narrow ones', () => {
    expect(getAutoFontSize(500, '漢漢漢漢漢')).toBeLessThan(
      getAutoFontSize(500, 'lllll'),
    )
  })
})

describe('getMonospaceFontSize', () => {
  test('clamps to the 10..300 range', () => {
    expect(getMonospaceFontSize(1, 'long text here')).toBe(10)
    expect(getMonospaceFontSize(1_000_000, 'hi')).toBe(300)
  })

  test('returns MIN for empty input', () => {
    expect(getMonospaceFontSize(500, '')).toBe(10)
  })

  test('more characters get smaller fonts', () => {
    expect(getMonospaceFontSize(500, 'abcdefghij')).toBeLessThan(
      getMonospaceFontSize(500, 'abc'),
    )
  })
})
```

Run: `bun test test/utils/font.test.ts` — expected PASS (characterization; if an assertion fails, adjust the assertion to the actual value after confirming the actual value is sane, since these lock in current behavior).

- [ ] **Step 2: Write the failing height-clamp tests**

Create `test/raster/draw.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { resolveFontSize } from '@/raster/draw'

const text = (data: string, fontSize?: number | 'AUTO' | 'AUTO_MONO') =>
  ({ type: 'text', data, fontSize }) as const

describe('resolveFontSize', () => {
  test('respects an explicit numeric size verbatim, even if it overflows', () => {
    expect(resolveFontSize(text('hi', 200), 500, 50)).toBe(200)
  })

  test('AUTO is clamped so all lines fit the height', () => {
    // 8 lines at 1.2 line-height in 120px of height => at most 12.5px each.
    const size = resolveFontSize(text('a\nb\nc\nd\ne\nf\ng\nh'), 2000, 120)
    expect(size * 8 * 1.2).toBeLessThanOrEqual(120 + 1e-9)
    expect(size).toBeGreaterThanOrEqual(10)
  })

  test('AUTO_MONO is clamped the same way', () => {
    const size = resolveFontSize(
      text('a\nb\nc\nd\ne\nf\ng\nh', 'AUTO_MONO'),
      2000,
      120,
    )
    expect(size * 8 * 1.2).toBeLessThanOrEqual(120 + 1e-9)
  })

  test('height clamp never goes below the 10px floor', () => {
    const size = resolveFontSize(text('a\nb\nc\nd\ne\nf\ng\nh'), 2000, 10)
    expect(size).toBe(10)
  })

  test('single-line AUTO in a tall canvas is not affected by the clamp', () => {
    expect(resolveFontSize(text('hello'), 500, 10_000)).toBe(
      resolveFontSize(text('hello'), 500, 500),
    )
  })
})
```

Run: `bun test test/raster/draw.test.ts`
Expected: FAIL — `resolveFontSize` takes 2 args and doesn't clamp.

- [ ] **Step 3: Implement**

In `src/raster/draw.ts` (the `LINE_HEIGHT_FACTOR` also replaces the magic `1.2` in `drawText`):

```ts
export const LINE_HEIGHT_FACTOR = 1.2
const MIN_FONT_SIZE = 10

export function resolveFontSize(
  item: Extract<AnimateItem, { type: 'text' }>,
  width: number,
  height: number,
): number {
  if (typeof item.fontSize === 'number') return item.fontSize
  const size =
    item.fontSize === 'AUTO_MONO'
      ? getMonospaceFontSize(width, item.data)
      : getAutoFontSize(width, item.data)
  // Width-derived sizes can overflow a short canvas when the text has many
  // lines; clamp so the whole block fits vertically (still floored at the
  // heuristics' minimum — better to clip than to vanish).
  const lines = item.data.split('\n').length
  const maxForHeight = height / (lines * LINE_HEIGHT_FACTOR)
  return Math.max(MIN_FONT_SIZE, Math.min(size, maxForHeight))
}
```

In `drawText`, update the call and the line-height constant:

```ts
  const fontSize = resolveFontSize(item, width, height)
  ...
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR
```

- [ ] **Step 4: Verify**

Run: `bun test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: clamp auto font sizing to the canvas height; add font/draw unit tests"
```

---

### Task 8: O(1) `settled()` — fuse convergence tracking into `stepField`

**Files:**
- Modify: `src/engine/rest.ts` (export the epsilons)
- Modify: `src/backends/canvas2d/simulate.ts` (`stepField` returns `boolean`)
- Modify: `src/backends/canvas2d/index.ts` (cache the flag)
- Test: `test/backends/canvas2d/simulate.test.ts`

**Interfaces:**
- Produces: `src/engine/rest.ts` exports `VEL_EPS_SQ: number`, `POS_EPS: number`, `COLOR_EPS: number`, `ALPHA_EPS: number` (same values, now `export const X: number = ...`). `isFieldSettled` unchanged — it remains the reference predicate and the pre-first-step answer.
- Produces: `stepField(field, dt, k, c, rand?): boolean` — returns true when, after this step, every slot satisfies the same convergence predicate as `isFieldSettled`.
- The canvas2d backend caches `stepField`'s return in `settledFlag: boolean | null` (null = no step since the last upload → fall back to `isFieldSettled`), making the per-frame `settled()` call O(1).

- [ ] **Step 1: Write the failing test**

Add to `test/backends/canvas2d/simulate.test.ts`:

```ts
import { isFieldSettled } from '@/engine/rest'

describe('stepField settled reporting', () => {
  test('reports unsettled while the spring is in flight, settled at rest, matching isFieldSettled', () => {
    const f = createField(4)
    f.count = 1
    f.active = 1
    f.homeX[0] = 100
    f.homeR[0] = 200
    f.targetAlpha[0] = 1
    const spring = tuneSpring({ settleTime: 0.85, zeta: 1 })
    // rand=0.5 → zero jitter, so the report is deterministic.
    let reported = stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    expect(reported).toBe(false)
    expect(isFieldSettled(f)).toBe(false)
    for (let i = 0; i < 90 * 5; i++) {
      reported = stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    }
    expect(reported).toBe(true)
    expect(isFieldSettled(f)).toBe(true)
  })

  test('reports settled for an empty field', () => {
    const f = createField(1)
    expect(stepField(f, 1 / 90, 10, 5, () => 0.5)).toBe(true)
  })
})
```

Run: `bun test test/backends/canvas2d/simulate.test.ts` — expected: FAIL (returns undefined).

- [ ] **Step 2: Implement**

`src/engine/rest.ts`: change the four `const` declarations to exported ones (keep values and comments):

```ts
export const VEL_EPS_SQ: number = 0.05 * 0.05
export const POS_EPS: number = 1
export const COLOR_EPS: number = 0.5
export const ALPHA_EPS: number = 0.01
```

`src/backends/canvas2d/simulate.ts`: import the epsilons, track convergence in the existing per-particle loop, return it:

```ts
import { ALPHA_EPS, COLOR_EPS, POS_EPS, VEL_EPS_SQ } from '@/engine/rest'
...
export function stepField(
  field: ParticleField,
  dt: number,
  k: number,
  c: number,
  rand: () => number = fastRand,
): boolean {
  ...
  let settled = true
  for (let i = 0; i < field.count; i++) {
    ... // existing physics updates, unchanged
    if (settled) {
      // Same predicate as isFieldSettled, evaluated on the just-updated
      // values — makes the engine's per-frame settled() check O(1).
      if (
        vx[i]! * vx[i]! + vy[i]! * vy[i]! > VEL_EPS_SQ ||
        Math.abs(x[i]! - homeX[i]!) > POS_EPS ||
        Math.abs(y[i]! - homeY[i]!) > POS_EPS ||
        (targetAlpha[i]! > 0.5
          ? alpha[i]! < 1 - ALPHA_EPS
          : alpha[i]! > ALPHA_EPS) ||
        Math.abs(r[i]! - homeR[i]!) > COLOR_EPS ||
        Math.abs(g[i]! - homeG[i]!) > COLOR_EPS ||
        Math.abs(b[i]! - homeB[i]!) > COLOR_EPS
      ) {
        settled = false
      }
    }
  }
  ... // existing compaction, unchanged
  return settled
}
```

`src/backends/canvas2d/index.ts`:

```ts
  let settledFlag: boolean | null = null
  ...
    uploadField(next): void {
      field = next
      settledFlag = null
    },
    step(dt): void {
      if (field) settledFlag = stepField(field, dt, k, c)
    },
    settled(): boolean {
      if (!field) return true
      // Before the first step after an upload there is no cached report yet.
      return settledFlag ?? isFieldSettled(field)
    },
```

- [ ] **Step 3: Verify**

Run: `bun test && bun run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "perf: fuse settle detection into stepField so settled() is O(1) per frame"
```

---

### Task 9: Always draw while running; drop `preserveDrawingBuffer`

**Files:**
- Modify: `src/engine/engine.ts` (remove `dirty` + 0-step draw skip)
- Modify: `src/backends/webgl2/gl.ts` (`preserveDrawingBuffer: false`)

**Interfaces:**
- Produces: while the loop runs, `backend.draw()` is called every frame unconditionally. The `dirty` flag disappears. `getGL` no longer requests `preserveDrawingBuffer`.

Rationale: `preserveDrawingBuffer: true` forces a copy-on-present on many GPUs — a per-drawn-frame cost paid to allow skipping cheap draws on 0-step frames. With draws unconditional, skipped-frame flicker is structurally impossible and the preserve cost disappears. The loop only runs during the ~1.5 s awake window (or in explicit `animate` mode where jitter changes every frame anyway), so the extra draws are bounded and cheap (GPU: one instanced draw; canvas2d: dirty-rect-limited putImageData).

- [ ] **Step 1: Simplify the engine loop**

In `src/engine/engine.ts`: delete the `dirty` variable, its comment, and the conditional; delete `dirty = true` from `wake()`:

```ts
  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    // Draw unconditionally: a skipped present is what made cleared-buffer
    // flicker possible on high-refresh displays, and skipping was only ever
    // worth it when preserveDrawingBuffer paid for it on every real present.
    backend.draw()
    if (idle === 'sleep' && (now >= awakeUntil || backend.settled?.())) {
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
  }
  ...
  const wake = (): void => {
    awakeUntil = performance.now() + SETTLE_SECONDS * 1000
    if (!running && visible) start()
  }
```

- [ ] **Step 2: Flip the context attribute**

In `src/backends/webgl2/gl.ts`:

```ts
export function getGL(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    // The engine draws on every running frame, so nothing depends on the
    // drawing buffer surviving a present — and preserveDrawingBuffer forces
    // a copy on every present on many GPUs. When the loop sleeps, no present
    // happens and the browser keeps compositing the last presented frame.
    preserveDrawingBuffer: false,
  })
}
```

- [ ] **Step 3: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS. Note for the final playground check: verify no flicker on transitions and that the last frame persists after the loop sleeps (webgl2 tier, high-refresh display if available).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "perf: draw every running frame and drop preserveDrawingBuffer copy cost"
```

---

### Task 10: `engine.setIdle` — no teardown on `idle` changes

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/components/dotimation.tsx`

**Interfaces:**
- Produces: `Engine.setIdle(next: IdleBehavior): void`. Switching to `'animate'` starts the loop (if visible); switching to `'sleep'` grants one settle window and lets the loop wind down naturally.
- The component drops `idle` from the engine-creation deps (a runtime `idle` flip currently tears down the whole backend — on WebGPU that re-requests the adapter/device and rebuilds pipelines) and pushes it live via a ref-guarded effect, mirroring the existing `dotSize` pattern.

- [ ] **Step 1: Implement `setIdle` in the engine**

In `src/engine/engine.ts`: change `const { backend, canvas, idle } = opts` to:

```ts
  const { backend, canvas } = opts
  let idle = opts.idle
```

Add to the `Engine` interface and returned object:

```ts
  /** Switch idle behavior live (read by the loop each frame) without recreating the engine. */
  setIdle(next: IdleBehavior): void
  ...
    setIdle(next): void {
      if (next === idle) return
      idle = next
      // 'animate' must run whenever visible; 'sleep' gets one settle window
      // so an in-flight morph finishes before the loop stops itself.
      if (idle === 'animate') {
        if (visible && !running) start()
      } else {
        wake()
      }
    },
```

- [ ] **Step 2: Rewire the component**

In `src/components/dotimation.tsx`, mirror the `dotSizeRef` pattern exactly:

```tsx
  // idle only affects loop policy, so push it to the live engine instead of
  // recreating it (which would tear down the backend — on WebGPU a full
  // device re-acquisition).
  const idleRef = useRef(idle)
  idleRef.current = idle
```

In the creation effect: remove `idle` from the dependency array, create the engine with `idle: idleRef.current`, and add a catch-up after the async init (next to the dotSize catch-up):

```tsx
      const constructedIdle = idleRef.current
      ...
      engine = createEngine({
        backend: selected.backend,
        canvas,
        dpr,
        idle: constructedIdle,
      })
      ...
      if (idleRef.current !== constructedIdle) {
        engine.setIdle(idleRef.current)
      }
```

Add the live-update effect next to the dotSize one:

```tsx
  useEffect(() => {
    engineRef.current?.setIdle(idle)
  }, [idle])
```

- [ ] **Step 3: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "perf: switch idle behavior live via engine.setIdle instead of recreating the backend"
```

---

### Task 11: Explicit GPU requests fall through the full cascade

**Files:**
- Modify: `src/engine/cascade.ts`
- Test: `test/engine/cascade.test.ts`

**Interfaces:**
- Produces: `resolveBackendOrder('webgpu', caps)` returns `['webgpu', 'webgl2', 'canvas2d']`. An explicit request means "start from this tier", not "this tier or software-only" — a machine without WebGPU but with WebGL2 should not land on canvas2d. `'webgl2'` and `'canvas2d'` requests are unchanged. Explicit requests still ignore `caps` (construct/init failure is the probe).

- [ ] **Step 1: Update the test**

In `test/engine/cascade.test.ts`, change the expectation for the explicit-webgpu case (and add it if absent):

```ts
  test('explicit webgpu request falls through the full tier ladder', () => {
    expect(
      resolveBackendOrder('webgpu', { webgpu: false, webgl2: false }),
    ).toEqual(['webgpu', 'webgl2', 'canvas2d'])
  })
```

Run: `bun test test/engine/cascade.test.ts` — expected: FAIL.

- [ ] **Step 2: Implement**

In `src/engine/cascade.ts`:

```ts
/**
 * Ordered tier list to try, from the requested starting tier down to the
 * always-present Canvas2D safety net. An explicit request pins the STARTING
 * tier (capabilities are not consulted — construct/init failure is the probe);
 * everything below it stays available as fallback, so `'webgpu'` on a machine
 * without WebGPU still gets WebGL2 rather than dropping straight to software.
 */
export function resolveBackendOrder(
  requested: BackendKind,
  caps: Capabilities,
): ConcreteBackend[] {
  if (requested === 'canvas2d') return ['canvas2d']
  if (requested === 'webgpu') return ['webgpu', 'webgl2', 'canvas2d']
  if (requested === 'webgl2') return ['webgl2', 'canvas2d']
  const order: ConcreteBackend[] = []
  if (caps.webgpu) order.push('webgpu')
  if (caps.webgl2) order.push('webgl2')
  order.push('canvas2d')
  return order
}
```

- [ ] **Step 3: Verify**

Run: `bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: explicit webgpu request falls back through webgl2 before canvas2d"
```

---

### Task 12: Integer PCG jitter hash in both GPU shaders

**Files:**
- Modify: `src/backends/webgl2/shaders/sim.vert.ts`
- Modify: `src/backends/webgl2/program-sim.ts` (`uSeed` becomes `uniform1ui`)
- Modify: `src/backends/webgl2/index.ts` (integer seed)
- Modify: `src/backends/webgpu/shaders/sim.wgsl.ts` (seed as `u32`)
- Modify: `src/backends/webgpu/index.ts` (u32 view into the uniform slice)

**Interfaces:**
- Produces: both GPU sims hash `particleIndex ^ seed` through PCG (output in `[0, 1)`, mirroring the CPU PRNG's `toUnit` contract). `SimUniforms.seed` (webgl2) is now documented as a 32-bit unsigned integer; the webgpu `Params.seed` field is `u32`. Seed generation on both backends: `(Math.random() * 0x100000000) >>> 0`.

Rationale: `fract(sin(n) * 43758.5…)` degrades visibly at large inputs on some GPUs (banding at high particle indices). PCG on `u32` is a drop-in with sound distribution.

- [ ] **Step 1: WebGL2 shader + program**

`src/backends/webgl2/shaders/sim.vert.ts` — replace the `uSeed` uniform, `hash` function, and jitter line:

```glsl
uniform uint uSeed;
...
// PCG output hash on u32 — uniform in [0, 1) (2^32 > max state, 1.0 unreachable),
// unlike fract(sin(x)*K) which bands at large x on some GPUs.
float hash01(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return float((word >> 22u) ^ word) / 4294967296.0;
}
...
  float j = (hash01(uint(gl_VertexID) ^ uSeed) - 0.5) * uJitter;
```

`src/backends/webgl2/program-sim.ts` — in `SimUniforms`, document `seed: number // 32-bit unsigned int`; in `step`, change:

```ts
      gl.uniform1ui(loc.uSeed, u.seed)
```

`src/backends/webgl2/index.ts` — in `step`:

```ts
        seed: (Math.random() * 0x100000000) >>> 0,
```

- [ ] **Step 2: WebGPU shader + uniform packing**

`src/backends/webgpu/shaders/sim.wgsl.ts` — change the struct field and jitter line:

```wgsl
struct Params {
  dt: f32, k: f32, c: f32, colorRate: f32,
  opacityRate: f32, jitter: f32, seed: u32, count: f32,
};
...
fn hash01(v: u32) -> f32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return f32((word >> 22u) ^ word) / 4294967296.0;
}
...
  nx = nx + (hash01(i ^ P.seed) - 0.5) * P.jitter;
```

`src/backends/webgpu/index.ts` — the uniform slice needs a u32 view over the same bytes as `simU`:

```ts
  const simUBytes = new ArrayBuffer(8 * 4)
  const simU = new Float32Array(simUBytes)
  const simUu32 = new Uint32Array(simUBytes)
```

and in `draw()`'s per-step loop:

```ts
          simUu32[6] = (Math.random() * 0x100000000) >>> 0
```

(the remaining `simU[...]` float writes are unchanged; slot 6 is simply written through the u32 view).

- [ ] **Step 3: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS (shader changes are playground-verified at the end).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: replace sin-fract GPU jitter hash with integer PCG matching the [0,1) contract"
```

---

### Task 13: Coalesce rasterization (latest-wins scheduling)

**Files:**
- Create: `src/utils/latest-wins.ts`
- Modify: `src/hooks/use-field-targets.ts`
- Test: `test/utils/latest-wins.test.ts` (create)

**Interfaces:**
- Produces: `export function createLatestWins<T>(run: (input: T) => Promise<void>): (input: T) => void` — at most one `run` in flight; while busy, only the newest submitted input is kept and it runs when the in-flight one finishes. `run` must not reject (callers own their error handling).
- `useFieldTargets` submits raster jobs through one scheduler instance; the existing `executionId` guard keeps stale results from publishing.

Rationale: today every accepted input change starts a full rasterize immediately; during a continuous resize that is one full pixel-walk per frame, all but the last discarded. Latest-wins caps concurrent work at 1 while guaranteeing the newest input always runs.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/latest-wins.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createLatestWins } from '@/utils/latest-wins'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createLatestWins', () => {
  test('runs immediately when idle', async () => {
    const ran: number[] = []
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
    })
    schedule(1)
    await Bun.sleep(0)
    expect(ran).toEqual([1])
  })

  test('while busy, keeps only the newest input and runs it after', async () => {
    const ran: number[] = []
    const gate = deferred()
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
      if (n === 1) await gate.promise
    })
    schedule(1) // starts, blocks on the gate
    schedule(2) // queued
    schedule(3) // replaces 2
    expect(ran).toEqual([1])
    gate.resolve()
    await Bun.sleep(0)
    expect(ran).toEqual([1, 3])
  })

  test('an input submitted after completion runs fresh', async () => {
    const ran: number[] = []
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
    })
    schedule(1)
    await Bun.sleep(0)
    schedule(2)
    await Bun.sleep(0)
    expect(ran).toEqual([1, 2])
  })
})
```

Run: `bun test test/utils/latest-wins.test.ts` — expected: FAIL (module missing).

- [ ] **Step 2: Implement `createLatestWins`**

Create `src/utils/latest-wins.ts`:

```ts
/**
 * Serializes async work with a one-slot queue: at most one `run` is in flight,
 * and while it runs only the NEWEST submitted input is kept. Used to coalesce
 * rasterization during input storms (e.g. a drag-resize) — every stale
 * intermediate is skipped, the latest always runs.
 *
 * `run` must handle its own errors; a rejection here would detach the chain.
 */
export function createLatestWins<T>(
  run: (input: T) => Promise<void>,
): (input: T) => void {
  let inFlight = false
  let queued: { input: T } | null = null

  const kick = (input: T): void => {
    inFlight = true
    void run(input).finally(() => {
      inFlight = false
      if (queued) {
        const next = queued.input
        queued = null
        kick(next)
      }
    })
  }

  return (input: T): void => {
    if (inFlight) queued = { input }
    else kick(input)
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test test/utils/latest-wins.test.ts`
Expected: PASS.

- [ ] **Step 4: Rewire `useFieldTargets`**

Restructure `src/hooks/use-field-targets.ts` so the effect only validates + submits, and the scheduler owns execution:

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
import type { FieldTargets } from '@/types'
import { createLatestWins } from '@/utils/latest-wins'
import { getDpr } from '@/utils/utils'

interface RasterJob {
  inputs: RasterInputs
  id: number
}

/** Worker-first rasterization with a main-thread fallback on any failure. */
function runRasterize(inputs: RasterInputs): Promise<FieldTargets> {
  const {
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
  } = inputs
  const dpr = getDpr()
  if (workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)) {
    return rasterizeViaWorker(
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
  }
  return rasterize(
    width,
    height,
    item,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
  )
}

export function useFieldTargets(
  item: RasterInputs['item'],
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
  // One scheduler per hook instance: rasterization storms (drag-resize) are
  // coalesced to "one in flight + the newest waiting" instead of one full
  // pixel walk per input change.
  const schedule = useRef<((job: RasterJob) => void) | null>(null)
  if (schedule.current === null) {
    schedule.current = createLatestWins<RasterJob>(async ({ inputs, id }) => {
      try {
        const t = await runRasterize(inputs)
        if (id === executionId.current) setTargets(t)
      } catch (err) {
        // Rasterization can reject (e.g. a cross-origin image fails to load or
        // the canvas is tainted). Keep the previously rendered targets, but
        // forget these inputs so a later render can retry them.
        if (id === executionId.current && prev.current === inputs) {
          prev.current = null
        }
        if (typeof console !== 'undefined') {
          console.warn('[dotimation] rasterization failed', err)
        }
      }
    })
  }

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
    schedule.current?.({ inputs: next, id })
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

Note: `item` was previously typed `AnimateItem` — keep that import/type if Biome flags the `RasterInputs['item']` indirection; either is fine as long as the public signature is unchanged.

- [ ] **Step 5: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "perf: coalesce rasterization with a latest-wins scheduler"
```

---

### Task 14: Cache decoded images (main thread + worker)

**Files:**
- Create: `src/utils/async-lru.ts`
- Modify: `src/raster/rasterize.ts`
- Modify: `src/raster/raster.worker.ts`
- Test: `test/utils/async-lru.test.ts` (create)

**Interfaces:**
- Produces: `export function createAsyncLru<V>(max: number, onEvict?: (value: Promise<V>) => void): { get(key: string): Promise<V> | undefined; set(key: string, value: Promise<V>): void; delete(key: string): void }` — insertion-ordered Map; `get` refreshes recency; `set` evicts oldest past `max` (calling `onEvict`).
- `rasterize.ts` gains a module-level `loadImage(src): Promise<HTMLImageElement>` using an LRU of 4; failed loads are deleted so they can retry.
- `raster.worker.ts` gains the same for `ImageBitmap` (evictions call `bitmap.close()`); the post-draw `bmp.close()` is removed (the cache owns bitmap lifetime). The worker's cache dies with the worker's 10 s idle self-termination, bounding memory.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/async-lru.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createAsyncLru } from '@/utils/async-lru'

describe('createAsyncLru', () => {
  test('stores and retrieves values', async () => {
    const lru = createAsyncLru<number>(2)
    lru.set('a', Promise.resolve(1))
    expect(await lru.get('a')).toBe(1)
    expect(lru.get('missing')).toBeUndefined()
  })

  test('evicts the least-recently-used entry past max', () => {
    const evicted: string[] = []
    const lru = createAsyncLru<string>(2, (v) => {
      void v.then((s) => evicted.push(s))
    })
    lru.set('a', Promise.resolve('A'))
    lru.set('b', Promise.resolve('B'))
    lru.get('a') // refresh: 'b' is now oldest
    lru.set('c', Promise.resolve('C'))
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBeDefined()
    expect(lru.get('c')).toBeDefined()
  })

  test('eviction callback receives the evicted promise', async () => {
    const evicted: number[] = []
    const lru = createAsyncLru<number>(1, (v) => {
      void v.then((n) => evicted.push(n))
    })
    lru.set('a', Promise.resolve(1))
    lru.set('b', Promise.resolve(2))
    await Bun.sleep(0)
    expect(evicted).toEqual([1])
  })

  test('delete removes without evict callback', () => {
    const evicted: number[] = []
    const lru = createAsyncLru<number>(2, (v) => {
      void v.then((n) => evicted.push(n))
    })
    lru.set('a', Promise.resolve(1))
    lru.delete('a')
    expect(lru.get('a')).toBeUndefined()
    expect(evicted).toEqual([])
  })
})
```

Run: `bun test test/utils/async-lru.test.ts` — expected: FAIL.

- [ ] **Step 2: Implement `createAsyncLru`**

Create `src/utils/async-lru.ts`:

```ts
/**
 * Tiny promise-valued LRU over an insertion-ordered Map. `get` refreshes
 * recency; `set` evicts the oldest entries past `max` (invoking `onEvict`
 * so resource-backed values — e.g. ImageBitmaps — can be released).
 * `delete` is for the owner discarding a failed load; it does NOT evict-notify.
 */
export interface AsyncLru<V> {
  get(key: string): Promise<V> | undefined
  set(key: string, value: Promise<V>): void
  delete(key: string): void
}

export function createAsyncLru<V>(
  max: number,
  onEvict?: (value: Promise<V>) => void,
): AsyncLru<V> {
  const map = new Map<string, Promise<V>>()
  return {
    get(key): Promise<V> | undefined {
      const value = map.get(key)
      if (value !== undefined) {
        map.delete(key)
        map.set(key, value)
      }
      return value
    },
    set(key, value): void {
      map.delete(key)
      map.set(key, value)
      for (const oldest of map.keys()) {
        if (map.size <= max) break
        const evicted = map.get(oldest)
        map.delete(oldest)
        if (evicted !== undefined) onEvict?.(evicted)
      }
    },
    delete(key): void {
      map.delete(key)
    },
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test test/utils/async-lru.test.ts`
Expected: PASS.

- [ ] **Step 4: Use it in both rasterizers**

`src/raster/rasterize.ts`:

```ts
import { createAsyncLru } from '@/utils/async-lru'
...
// Decoded-image cache: a resize storm re-rasterizes the same URL dozens of
// times; caching the decoded element skips the fetch+decode each time. Small
// cap — entries are full decoded images.
const imageCache = createAsyncLru<HTMLImageElement>(4)

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached
  const loading = (async () => {
    const image = new Image()
    // crossOrigin must be set BEFORE src or the request goes out without CORS,
    // tainting the canvas and making getImageData throw for cross-origin images.
    image.crossOrigin = 'anonymous'
    image.src = src
    await image.decode()
    return image
  })()
  // Drop failed loads so a later render can retry them.
  loading.catch(() => imageCache.delete(src))
  imageCache.set(src, loading)
  return loading
}
```

and in `rasterize()` replace the inline image block with:

```ts
  if (item.type === 'image') {
    const image = await loadImage(item.data)
    drawImage(ctx, image, image.width, image.height, width, height, item)
  } else {
```

`src/raster/raster.worker.ts` (bundled standalone — the import is inlined by `build-worker`):

```ts
import { createAsyncLru } from '../utils/async-lru'
...
// Decoded-bitmap cache; evicted bitmaps are closed to release their pixel
// memory. The cache dies with the worker's ~10 s idle self-termination.
const bitmapCache = createAsyncLru<ImageBitmap>(4, (evicted) => {
  evicted.then(
    (bmp) => bmp.close(),
    () => {},
  )
})

function loadBitmap(src: string): Promise<ImageBitmap> {
  const cached = bitmapCache.get(src)
  if (cached) return cached
  const loading = (async () => {
    const res = await fetch(src, { mode: 'cors' })
    return createImageBitmap(await res.blob())
  })()
  loading.catch(() => bitmapCache.delete(src))
  bitmapCache.set(src, loading)
  return loading
}
```

and in `run()`:

```ts
  if (req.item.type === 'image') {
    const bmp = await loadBitmap(req.item.data)
    drawImage(ctx, bmp, bmp.width, bmp.height, req.width, req.height, req.item)
  } else {
```

(the `bmp.close()` call is deleted — the cache owns bitmap lifetime now).

- [ ] **Step 5: Regenerate the worker bundle and verify**

Run: `bun run build:worker && bun test && bun run type-check && bun run lint`
Expected: PASS; `build:worker` succeeds with the new import inlined.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "perf: cache decoded images/bitmaps with a small LRU in both rasterizers"
```

---

### Task 15: `prefers-reduced-motion` support (snap morphs, zero jitter)

**Files:**
- Create: `src/hooks/use-reduced-motion.ts`
- Modify: `src/engine/field.ts` (add `snapField`)
- Modify: `src/types.ts` (`uploadField(field, full?)`)
- Modify: `src/engine/engine.ts` (`setField(field, full?)`)
- Modify: `src/engine/select.ts` (+ `jitter` option), `src/backends/canvas2d/{index,simulate}.ts`, `src/backends/webgl2/index.ts`, `src/backends/webgpu/index.ts`
- Modify: `src/components/dotimation.tsx`
- Test: `test/engine/field.test.ts` (snapField)

**Interfaces:**
- Produces: `export function useReducedMotion(): boolean` — `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`; `false` on the server.
- Produces: `export function snapField(field: ParticleField): void` — completes the morph instantly: positions/colors to home, velocities zeroed, `alpha = targetAlpha`, then `count = active` (fully-faded faders dropped).
- Produces: `Backend.uploadField(field: ParticleField, full?: boolean): void` — `full` forces a complete state re-upload `[0, field.count)` and adopts `field.active`/`field.count` verbatim (GPU tiers; canvas2d reads the field directly and ignores it). `Engine.setField(field: ParticleField, full?: boolean)` passes it through.
- Produces: backend options gain `jitter: number` (`Canvas2DOptions`, `WebGL2Options`, `WebGPUOptions`, `SelectOptions`); `stepField` gains a trailing `jitterAmount: number = JITTER_AMOUNT` parameter. Reduced motion constructs backends with `jitter: 0`.
- The component: reduced-motion flips recreate the engine (rare OS-level event; the canvas `key` gains the flag) so the jitter setting applies; morphs are snapped + fully uploaded while active.

Behavior under reduced motion: no movement at all — content changes are communicated by short opacity fades only (fades are not vestibular triggers; an instant blink is worse UX).

- [ ] **Step 1: Write the failing snapField test**

Add to `test/engine/field.test.ts`:

```ts
import { createField, growField, nextPow2, reconcile, snapField } from '@/engine/field'
import { isFieldSettled } from '@/engine/rest'
...
describe('snapField', () => {
  test('completes the morph instantly and drops faded faders', () => {
    const f = createField(4)
    f.active = 1
    f.count = 2
    // live slot mid-flight
    f.x[0] = 5
    f.y[0] = 5
    f.vx[0] = 40
    f.homeX[0] = 20
    f.homeY[0] = 30
    f.homeR[0] = 200
    f.alpha[0] = 0.3
    f.targetAlpha[0] = 1
    // fader mid-fade
    f.alpha[1] = 0.5
    f.targetAlpha[1] = 0
    snapField(f)
    expect(f.x[0]).toBe(20)
    expect(f.y[0]).toBe(30)
    expect(f.vx[0]).toBe(0)
    expect(f.r[0]).toBe(200)
    expect(f.alpha[0]).toBe(1)
    expect(f.count).toBe(1)
    expect(isFieldSettled(f)).toBe(true)
  })
})
```

Run: `bun test test/engine/field.test.ts` — expected: FAIL.

- [ ] **Step 2: Implement `snapField`**

In `src/engine/field.ts`:

```ts
/**
 * Completes the current morph instantly: every slot lands at its home with its
 * home color, velocities zeroed and alpha at its target; fully-faded faders are
 * dropped. Used for prefers-reduced-motion — content changes become opacity
 * fades with no movement. The result satisfies isFieldSettled.
 */
export function snapField(field: ParticleField): void {
  const { x, y, vx, vy, homeX, homeY, r, g, b, homeR, homeG, homeB, alpha, targetAlpha } = field
  for (let i = 0; i < field.count; i++) {
    x[i] = homeX[i]!
    y[i] = homeY[i]!
    vx[i] = 0
    vy[i] = 0
    r[i] = homeR[i]!
    g[i] = homeG[i]!
    b[i] = homeB[i]!
    alpha[i] = targetAlpha[i]!
  }
  // Faders snapped to alpha 0 are invisible; drop them from the tail.
  field.count = field.active
}
```

Run: `bun test test/engine/field.test.ts` — expected: PASS.

- [ ] **Step 3: Thread `full` through upload**

`src/types.ts`:

```ts
  /**
   * Push the reconciled CPU field. `full` forces a complete state re-upload
   * (GPU tiers adopt field.active/count verbatim instead of diffing via
   * planReconcile) — used when the CPU field was mutated outside reconcile,
   * e.g. snapField under prefers-reduced-motion.
   */
  uploadField(field: ParticleField, full?: boolean): void
```

`src/engine/engine.ts` — `Engine.setField(field: ParticleField, full?: boolean): void`, implementation `backend.uploadField(field, full)`.

`src/backends/webgl2/index.ts` `uploadField(field, full = false)` — after `ensureCapacity` + the targets upload, add before the plan logic:

```ts
      if (full) {
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          packStateInto(stateScratch, field, 0, field.count),
        )
        active = field.active
        count = field.count
        lastUpload = performance.now()
        return
      }
```

`src/backends/webgpu/index.ts` — same shape with `device.queue.writeBuffer(current, 0, packStateInto(stateScratch, field, 0, field.count))`.

`src/backends/canvas2d/index.ts` — signature `uploadField(next, _full?)`: it reads the field directly; no other change (keep the `settledFlag = null` reset from Task 8).

- [ ] **Step 4: Thread `jitter` through the backends**

- `src/backends/canvas2d/simulate.ts`: `stepField(field, dt, k, c, rand = fastRand, jitterAmount: number = JITTER_AMOUNT): boolean` — the jitter line becomes `(rand() - 0.5) * jitterAmount`.
- `Canvas2DOptions` gains `jitter: number`; the backend stores it and calls `stepField(field, dt, k, c, undefined, jitter)`.
- `WebGL2Options`/`WebGPUOptions` gain `jitter: number`; replace the `JITTER_AMOUNT` usages in their `step`/`draw` uniform packing with the stored option (delete the now-unused import).
- `src/engine/select.ts`: `SelectOptions` gains `jitter: number`; `construct(kind, dotSize, jitter)` passes it to each factory.

- [ ] **Step 5: Wire the component**

Create `src/hooks/use-reduced-motion.ts`:

```ts
import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
}

function getServerSnapshot(): boolean {
  return false
}

/** Live view of the user's prefers-reduced-motion setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
```

In `src/components/dotimation.tsx`:

```tsx
  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion
```

- Engine-creation effect: add `reducedMotion` to the dependency array; pass `jitter: reducedMotion ? 0 : JITTER_AMOUNT` to `selectBackend` (import `JITTER_AMOUNT` from `@/engine/constants`). Inside the effect body, read the state value directly (it IS a dep now).
- Canvas `key` becomes `` `${backend}:${dprEpoch}:${reducedMotion ? 'rm' : 'm'}` `` (fresh canvas per engine incarnation, matching the recreation deps).
- Targets effect:

```tsx
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    // Reduced motion: complete the morph instantly (opacity-only change) and
    // force a full GPU re-upload since the field changed outside reconcile.
    const snap = reducedMotionRef.current
    if (snap) snapField(fieldRef.current)
    engineRef.current.setField(fieldRef.current, snap)
    onStatsRef.current?.({
      backend: kindRef.current,
      particles: fieldRef.current.active,
    })
  }, [targets])
```

- Same snap treatment in the creation effect's initial `setField` (the `if (targetsRef.current)` block):

```tsx
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        if (reducedMotion) snapField(fieldRef.current)
        engine.setField(fieldRef.current, reducedMotion)
      }
```

- [ ] **Step 6: Verify**

Run: `bun test && bun run type-check && bun run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: honor prefers-reduced-motion (snap morphs, opacity-only changes, zero jitter)"
```

---

### Task 16: A11y, React 19 ref prop, `sideEffects`, docs sync, final verification

**Files:**
- Modify: `src/components/dotimation.tsx` (aria + ref prop)
- Modify: `package.json` (`sideEffects: false`)
- Modify: `CLAUDE.md` (sync with all changes)

**Interfaces:**
- Produces: `DotimationProps` gains `ref?: React.Ref<HTMLCanvasElement>` (React 19 ref-as-prop) and `ariaLabel?: string`; `canvasRef` stays but is `@deprecated`. The canvas renders `role="img"` with `aria-label` defaulting to `item.data` for text items.

- [ ] **Step 1: Component API polish**

In `src/components/dotimation.tsx`:

```tsx
type DotimationProps = {
  item: AnimateItem
  width: number
  height: number
  /** React 19 ref to the underlying canvas element. */
  ref?: React.Ref<HTMLCanvasElement>
  /** @deprecated Pass `ref` instead (React 19 forwards it as a regular prop). */
  canvasRef?: React.RefObject<HTMLCanvasElement>
  /**
   * Accessible name for the canvas (rendered with role="img"). Defaults to the
   * text content for text items; supply one for image items.
   */
  ariaLabel?: string
  ...
}
```

Destructure `ref: forwardedRef` and `ariaLabel` in the component. Replace the single `useImperativeHandle` with:

```tsx
  useImperativeHandle(forwardedRef, () => ref.current!)
  useImperativeHandle(canvasRef, () => ref.current!)
```

Canvas JSX gains:

```tsx
      role="img"
      aria-label={ariaLabel ?? (item.type === 'text' ? item.data : undefined)}
```

- [ ] **Step 2: `sideEffects` flag**

In `package.json`, add next to `"type": "module"`:

```json
  "sideEffects": false,
```

(All module-level statements are pure computations — PRNG seeding, constant derivation — safe to drop when unused.)

- [ ] **Step 3: Sync CLAUDE.md**

Update `CLAUDE.md` to reflect: viewport.ts/resolveBackendKind removal; `gpu-shared.ts` as the home of GPU layout/packers (and that `reconcile-plan.ts` is now planner-only); dotSize = CSS px on all tiers; always-draw engine + `preserveDrawingBuffer: false`; `engine.setIdle`; explicit-webgpu full cascade; latest-wins raster coalescing + image LRU caches; reduced-motion support (`snapField`, `uploadField(field, full)`, per-backend `jitter` option); a11y props; `getDpr` as the single DPR source. Keep the existing document structure; edit the affected sections only.

- [ ] **Step 4: Full verification**

```bash
bun install && bun run build && bun run type-check && bun run lint && bun test
```

Expected: all green, `dist/` builds, worker source regenerates.

- [ ] **Step 5: Playground smoke test (manual/visual)**

Run `bun run dev` and verify in the browser (all three backends via the playground's backend switcher):
- morphs between texts/images still animate identically across tiers
- live resize has no blank flashes
- dots render the same visual size at browser zoom 100% vs 200% (dpr change)
- with OS reduced-motion enabled: no movement, opacity-only changes
- after a transition settles, CPU idles (~0% — loop sleeps)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: a11y roles/labels, React 19 ref prop, sideEffects flag, docs sync"
```
