# Dotimation P3 — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four P3 polish items — `maxParticles` cap, `onStats` + benchmark harness, cross-tier render parity, and off-main-thread worker rasterization — with no breaking changes.

**Architecture:** Each item is independent. Pure logic (sample truncation, `isWorkerSafe`) is unit-tested under `bun test`; shader/blend/worker/component changes are playground-verified. The worker is purely an optimization with a guaranteed main-thread fallback; a correctness-first font rule keeps custom-font text on the main thread.

**Tech Stack:** TypeScript (strict, `isolatedDeclarations`), React 19, OffscreenCanvas + module Web Worker, WebGL2/WebGPU, Bun, Biome.

---

## Conventions for every task

- `isolatedDeclarations` → explicit return types on exports. `noUncheckedIndexedAccess` → `!` where valid. Biome: single quotes, no semicolons, 2-space indent; `bun run lint:fix` before commit.
- The full `bun run type-check && bun run lint && bun test` currently PASS (34 tests) and must stay green. Commit normally (NO `--no-verify`).
- GPU/worker/component changes have no unit tests — gate is type-check + lint + test green; real verification is the playground.

---

## Task 1: `maxParticles` in the sampler (pure)

**Files:**
- Modify: `src/raster/sample.ts`
- Test: `test/raster/sample.test.ts`

The sampler already Fisher–Yates-shuffles its output order, so a cap is a clean truncation of the shuffled set → a uniform random subset.

- [ ] **Step 1: Add the failing test** (append to `test/raster/sample.test.ts`):

```ts
import { describe, expect, test } from 'bun:test'
import { sampleTargets } from '@/raster/sample'

describe('sampleTargets maxParticles', () => {
  // 4x4 fully-opaque image → 16 candidate pixels at step 1.
  function opaque(): Uint8ClampedArray {
    const p = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) p[i * 4 + 3] = 255
    return p
  }

  test('caps the count to maxParticles', () => {
    const t = sampleTargets(opaque(), 4, 4, 1, 1, 128, () => 0, 5)
    expect(t.count).toBe(5)
    expect(t.homeX.length).toBe(5)
  })

  test('keeps all when cap exceeds the sample', () => {
    const t = sampleTargets(opaque(), 4, 4, 1, 1, 128, () => 0, 100)
    expect(t.count).toBe(16)
  })

  test('unbounded by default', () => {
    const t = sampleTargets(opaque(), 4, 4, 1, 1, 128, () => 0)
    expect(t.count).toBe(16)
  })
})
```

Run `bun test test/raster/sample.test.ts` → FAIL (8th arg unused / count not capped).

- [ ] **Step 2: Implement.** In `src/raster/sample.ts`, add a `maxParticles` parameter and cap the kept count after the shuffle. Change the signature and the final allocation:

```ts
export function sampleTargets(
  pixels: Uint8ClampedArray,
  devW: number,
  devH: number,
  dpr: number,
  pointSpacingCss: number,
  alpha: number,
  rand: () => number = Math.random,
  maxParticles: number = Number.POSITIVE_INFINITY,
): FieldTargets {
```

Keep the sampling + shuffle of `order` exactly as-is. Then replace the final-array section so it writes only the capped count:

```ts
  const keep = Math.min(n, Math.max(0, Math.floor(maxParticles)))
  const t: FieldTargets = {
    count: keep,
    homeX: new Float32Array(keep),
    homeY: new Float32Array(keep),
    homeR: new Float32Array(keep),
    homeG: new Float32Array(keep),
    homeB: new Float32Array(keep),
  }
  for (let i = 0; i < keep; i++) {
    const k = order[i]!
    t.homeX[i] = xs[k]!
    t.homeY[i] = ys[k]!
    t.homeR[i] = rs[k]!
    t.homeG[i] = gs[k]!
    t.homeB[i] = bs[k]!
  }
  return t
```

(`order` is shuffled, so the first `keep` indices are a uniform random subset.)

Run `bun test test/raster/sample.test.ts` → PASS (existing 3 + new 3).

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && git add src/raster/sample.ts test/raster/sample.test.ts
git commit -m "feat: maxParticles cap in the pixel sampler"
```

---

## Task 2: Thread `maxParticles` through rasterize → hook → prop

**Files:**
- Modify: `src/raster/rasterize.ts`, `src/hooks/use-field-targets.ts`, `src/components/dotimation.tsx`

- [ ] **Step 1: `rasterize`** — add a trailing `maxParticles` param (default `Number.POSITIVE_INFINITY`) and pass it to `sampleTargets`:

In `src/raster/rasterize.ts`, change the signature to add `maxParticles: number = Number.POSITIVE_INFINITY,` as the last parameter, and update the final call to `sampleTargets(img.data, devW, devH, dpr, pointSpacingCss, alpha, Math.random, maxParticles)`.

- [ ] **Step 2: `useFieldTargets`** — add `maxParticles` param, pass to `rasterize`, and add it to the effect deps so changing it re-rasterizes:

In `src/hooks/use-field-targets.ts`, add `maxParticles: number,` to the params, pass it as the last arg to `rasterize(...)`, and add `maxParticles` to the `useEffect` dependency array.

- [ ] **Step 3: Component prop.** In `src/components/dotimation.tsx`, add `maxParticles?: number` to `DotimationProps` (with a `/** @default unbounded */` doc), default it in the destructure to `Number.POSITIVE_INFINITY`, and pass it to `useFieldTargets(item, width, height, defaultFontFamily, alpha, pointSpacingCss, maxParticles)`.

- [ ] **Step 4: Gate + commit**

Run `bun run type-check && bun run lint && bun test` (34, green).

```bash
bun run lint:fix && git add src/raster/rasterize.ts src/hooks/use-field-targets.ts src/components/dotimation.tsx
git commit -m "feat: thread maxParticles through rasterize, hook, and prop"
```

---

## Task 3: Cross-tier render parity (WebGL2 premultiplied + snap; WebGPU snap)

**Files:**
- Modify: `src/backends/webgl2/gl.ts`, `src/backends/webgl2/index.ts`, `src/backends/webgl2/shaders/draw.vert.ts`, `src/backends/webgpu/shaders/draw.wgsl.ts`

WebGL2's current `premultipliedAlpha:false` + `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` mis-composites translucent dots. Match WebGPU's correct premultiplied source-over, and snap both GPU tiers to the device-pixel grid like Canvas2D.

- [ ] **Step 1: WebGL2 context → premultiplied.** In `src/backends/webgl2/gl.ts`, change the `getGL` context options `premultipliedAlpha: false` → `premultipliedAlpha: true`.

- [ ] **Step 2: WebGL2 blend → separate alpha.** In `src/backends/webgl2/index.ts` `init`, replace `gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)` with:

```ts
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      )
```

(Straight-alpha frag output + this blend yields a premultiplied framebuffer, matching the `premultipliedAlpha:true` canvas and WebGPU — correct source-over for both color and alpha.)

- [ ] **Step 3: WebGL2 sub-pixel snap.** In `src/backends/webgl2/shaders/draw.vert.ts`, snap the instance position to the device-pixel grid. Change the `dev` line:

```glsl
  vec2 dev = floor(aInstancePos * uDpr + 0.5) + aCorner * uDotSize;
```

(Replaces `aInstancePos * uDpr + (aCorner - 0.5) * uDotSize + uDotSize * 0.5`, which equals `aInstancePos*uDpr + aCorner*uDotSize` — now with the base rounded to match Canvas2D's `(x*dpr+0.5)|0`.)

- [ ] **Step 4: WebGPU sub-pixel snap (consistency).** In `src/backends/webgpu/shaders/draw.wgsl.ts`, change the `dev` line:

```wgsl
  let dev = floor(instPos * R.dpr + vec2<f32>(0.5, 0.5)) + corner * R.dotSize;
```

- [ ] **Step 5: Gate + commit**

Run `bun run type-check && bun run lint && bun test` (34, green). (No unit test for shaders; parity is playground-verified in Task 7.)

```bash
bun run lint:fix && git add src/backends/webgl2/gl.ts src/backends/webgl2/index.ts src/backends/webgl2/shaders/draw.vert.ts src/backends/webgpu/shaders/draw.wgsl.ts
git commit -m "fix: cross-tier render parity (webgl2 premultiplied blend; device-px snap)"
```

---

## Task 4: `onStats` callback (resolved backend + particle count)

**Files:**
- Modify: `src/types.ts`, `src/engine/select.ts`, `src/components/dotimation.tsx`

- [ ] **Step 1: Types.** In `src/types.ts`, add:

```ts
export interface DotimationStats {
  backend: 'webgpu' | 'webgl2' | 'canvas2d'
  particles: number
}
```

- [ ] **Step 2: `selectBackend` returns the resolved kind.** In `src/engine/select.ts`, change the return type to `Promise<{ backend: Backend; kind: ConcreteBackend }>`. In the loop, `return { backend: be, kind }`; in the final fallback, `return { backend: be, kind: 'canvas2d' }`. (Import `ConcreteBackend` is already present.)

- [ ] **Step 3: Component reports stats.** In `src/components/dotimation.tsx`:
  - Add `onStats?: (stats: DotimationStats) => void` to `DotimationProps` and import `DotimationStats`.
  - Add a `kindRef = useRef<'webgpu' | 'webgl2' | 'canvas2d'>('canvas2d')`.
  - In the engine-creation effect, destructure `const { backend: be, kind } = await selectBackend({...})`, set `kindRef.current = kind`, and after seeding the field call `onStats?.({ backend: kind, particles: fieldRef.current.active })`.
  - In the targets-push effect, after `engineRef.current.setField(...)`, call `onStats?.({ backend: kindRef.current, particles: fieldRef.current.active })`.
  - Add `onStats` is intentionally NOT in the effect dep arrays (it's a reporting callback; including it would re-create the engine when an inline callback identity changes). Reference it via a ref to avoid stale closures: add `const onStatsRef = useRef(onStats); onStatsRef.current = onStats` and call `onStatsRef.current?.(...)`.

- [ ] **Step 4: Gate + commit**

Run `bun run type-check && bun run lint && bun test` (34, green).

```bash
bun run lint:fix && git add src/types.ts src/engine/select.ts src/components/dotimation.tsx
git commit -m "feat: onStats callback exposing resolved backend + particle count"
```

---

## Task 5: `isWorkerSafe` (pure) + shared draw helpers

**Files:**
- Create: `src/raster/draw.ts`
- Create: `src/raster/worker-safe.ts`
- Test: `test/raster/worker-safe.test.ts`
- Modify: `src/raster/rasterize.ts` (use the shared draw helpers)

- [ ] **Step 1: `isWorkerSafe` failing test.** Create `test/raster/worker-safe.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { isWorkerSafe } from '@/raster/worker-safe'
import type { AnimateItem } from '@/types'

const img: AnimateItem = { type: 'image', data: 'x.png' }
const txt = (fontFamily?: string): AnimateItem => ({ type: 'text', data: 'hi', fontFamily })

describe('isWorkerSafe', () => {
  test('images are always worker-safe', () => {
    expect(isWorkerSafe(img, 'sans-serif')).toBe(true)
  })
  test('generic font families are worker-safe', () => {
    expect(isWorkerSafe(txt('monospace'), 'sans-serif')).toBe(true)
    expect(isWorkerSafe(txt('system-ui'), 'sans-serif')).toBe(true)
    expect(isWorkerSafe(txt(undefined), 'serif')).toBe(true) // falls back to default (generic)
  })
  test('custom font families are NOT worker-safe (kept on main thread)', () => {
    expect(isWorkerSafe(txt('Inter'), 'sans-serif')).toBe(false)
    expect(isWorkerSafe(txt('"My Font"'), 'sans-serif')).toBe(false)
  })
})
```

Run `bun test test/raster/worker-safe.test.ts` → FAIL.

- [ ] **Step 2: Implement `isWorkerSafe`.** Create `src/raster/worker-safe.ts`:

```ts
import type { AnimateItem } from '@/types'

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji', 'fangsong',
])

/**
 * Whether `item` can be rasterized in a Web Worker without a font discrepancy.
 * Images always can. Text can only when its resolved family is a CSS generic
 * (workers have a separate font set, so custom fonts must stay on the main
 * thread where the document's fonts are available).
 */
export function isWorkerSafe(item: AnimateItem, defaultFontFamily: string): boolean {
  if (item.type === 'image') return true
  const family = (item.fontFamily ?? defaultFontFamily).trim().toLowerCase()
  return GENERIC_FAMILIES.has(family)
}
```

Run `bun test test/raster/worker-safe.test.ts` → PASS.

- [ ] **Step 3: Extract shared draw helpers.** Create `src/raster/draw.ts` so the main thread and the worker share the drawing/scaling math (image LOADING stays caller-specific). Move the font-size resolution, the text drawing, and the image scale+draw out of `rasterize.ts`:

```ts
import type { AnimateItem } from '@/types'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'

export const DEFAULT_TEXT_COLOR = 'rgb(200,200,200)'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function resolveFontSize(
  item: Extract<AnimateItem, { type: 'text' }>,
  width: number,
): number {
  if (item.fontSize === 'AUTO_MONO') return getMonospaceFontSize(width, item.data)
  if (item.fontSize === 'AUTO' || item.fontSize === undefined) {
    return getAutoFontSize(width, item.data)
  }
  return item.fontSize
}

export function drawText(
  ctx: Ctx2D,
  item: Extract<AnimateItem, { type: 'text' }>,
  width: number,
  height: number,
  defaultFontFamily: string,
): void {
  const fontSize = resolveFontSize(item, width)
  ctx.font = `${fontSize}px ${item.fontFamily || defaultFontFamily}`
  ctx.fillStyle = item.textColor || DEFAULT_TEXT_COLOR
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = item.data.split('\n')
  const lineHeight = fontSize * 1.2
  const startY = (height - lines.length * lineHeight) / 2 + lineHeight / 2
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, width / 2, startY + index * lineHeight)
  }
}

export function imageScale(
  width: number,
  height: number,
  imgW: number,
  imgH: number,
  item: Extract<AnimateItem, { type: 'image' }>,
): number {
  const wScale = item.maxWidth ? item.maxWidth / imgW : Number.POSITIVE_INFINITY
  const hScale = item.maxHeight ? item.maxHeight / imgH : Number.POSITIVE_INFINITY
  const userScale = Math.min(wScale, hScale)
  const scaleLimit = Math.min(width / imgW, height / imgH)
  return Math.min(userScale, scaleLimit)
}

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
  if (item.invert) {
    ctx.save()
    ctx.filter = 'invert(1)'
    ctx.drawImage(image, x, y, sw, sh)
    ctx.restore()
  } else {
    ctx.drawImage(image, x, y, sw, sh)
  }
}
```

Then refactor `src/raster/rasterize.ts` to use `drawText`/`drawImage`/`imageScale` (it loads the image with `new Image()` + `decode()` as today, then calls `drawImage(ctx, image, image.width, image.height, width, height, item)`; text uses `drawText(ctx, item, width, height, defaultFontFamily)`). Behavior unchanged.

- [ ] **Step 4: Gate + commit**

Run `bun run type-check && bun run lint && bun test` (34 + 3 = 37, green). The image presets in the playground (Task 7) confirm `rasterize` still works after the refactor.

```bash
bun run lint:fix && git add src/raster/draw.ts src/raster/worker-safe.ts test/raster/worker-safe.test.ts src/raster/rasterize.ts
git commit -m "feat: isWorkerSafe font rule + shared draw helpers"
```

---

## Task 6: Worker rasterization + host + selection with fallback

**Files:**
- Create: `src/raster/raster.worker.ts`
- Create: `src/raster/rasterize-worker.ts`
- Modify: `src/hooks/use-field-targets.ts`

DOM/worker-bound; verified in the playground. The worker is purely an optimization — every failure path falls back to main-thread `rasterize`.

- [ ] **Step 1: The worker.** Create `src/raster/raster.worker.ts`:

```ts
/// <reference lib="webworker" />
import type { AnimateItem, FieldTargets } from '@/types'
import { drawImage, drawText } from './draw'
import { sampleTargets } from './sample'

interface RasterRequest {
  id: number
  item: AnimateItem
  width: number
  height: number
  defaultFontFamily: string
  alpha: number
  pointSpacingCss: number
  maxParticles: number
  dpr: number
}

async function run(req: RasterRequest): Promise<FieldTargets> {
  const w = Math.round(req.width * req.dpr)
  const h = Math.round(req.height * req.dpr)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('worker: no 2d context')
  ctx.setTransform(req.dpr, 0, 0, req.dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  if (req.item.type === 'image') {
    const res = await fetch(req.item.data, { mode: 'cors' })
    const bmp = await createImageBitmap(await res.blob())
    drawImage(ctx, bmp, bmp.width, bmp.height, req.width, req.height, req.item)
    bmp.close()
  } else {
    drawText(ctx, req.item, req.width, req.height, req.defaultFontFamily)
  }

  const img = ctx.getImageData(0, 0, w, h)
  return sampleTargets(img.data, w, h, req.dpr, req.pointSpacingCss, req.alpha, Math.random, req.maxParticles)
}

self.onmessage = (e: MessageEvent<RasterRequest>): void => {
  run(e.data).then(
    (targets) => {
      const transfer = [
        targets.homeX.buffer, targets.homeY.buffer, targets.homeR.buffer,
        targets.homeG.buffer, targets.homeB.buffer,
      ]
      ;(self as DedicatedWorkerGlobalScope).postMessage({ id: e.data.id, targets }, transfer)
    },
    (err) => {
      ;(self as DedicatedWorkerGlobalScope).postMessage({ id: e.data.id, error: String(err) })
    },
  )
}
```

- [ ] **Step 2: The host.** Create `src/raster/rasterize-worker.ts`:

```ts
import type { AnimateItem, FieldTargets } from '@/types'

interface Pending {
  resolve: (t: FieldTargets) => void
  reject: (e: unknown) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent): void => {
      const { id, targets, error } = e.data as { id: number; targets?: FieldTargets; error?: string }
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (error || !targets) p.reject(new Error(error ?? 'worker: empty result'))
      else p.resolve(targets)
    }
    worker.onerror = (): void => {
      // Fail all in-flight requests; callers fall back to the main thread.
      for (const [, p] of pending) p.reject(new Error('worker: error'))
      pending.clear()
      worker = null
    }
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
  const id = nextId++
  return new Promise<FieldTargets>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, item, width, height, defaultFontFamily, alpha, pointSpacingCss, maxParticles, dpr })
  })
}
```

- [ ] **Step 3: Hook selects worker with fallback.** In `src/hooks/use-field-targets.ts`, replace the single `rasterize(...)` call with a worker-first attempt that falls back to main-thread `rasterize` on any failure. Add imports and a small helper inside the effect:

```ts
import { rasterize } from '@/raster/rasterize'
import { rasterizeViaWorker, workerRasterAvailable } from '@/raster/rasterize-worker'
import { isWorkerSafe } from '@/raster/worker-safe'
```

Replace the `rasterize(...)` promise with:

```ts
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const useWorker = workerRasterAvailable() && isWorkerSafe(item, defaultFontFamily)
    const task = useWorker
      ? rasterizeViaWorker(width, height, item, defaultFontFamily, alpha, pointSpacingCss, maxParticles, dpr).catch(
          () => rasterize(width, height, item, defaultFontFamily, alpha, pointSpacingCss, maxParticles),
        )
      : rasterize(width, height, item, defaultFontFamily, alpha, pointSpacingCss, maxParticles)
    task.then((t) => {
      if (id === executionId.current) setTargets(t)
    })
```

(Keep the `executionId` stale-guard and the change-detection logic exactly as-is.)

- [ ] **Step 4: Gate + commit**

Run `bun run type-check && bun run lint && bun test` (green). `bun run build` — confirm it completes without error.

**Build contingency:** Bun's bundler recognizes `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })` and emits a worker chunk, so `bunup` should build cleanly. If `bun run build` instead ERRORS on the worker URL, do NOT block: the worker is an optional optimization with a full runtime fallback. Make the build tolerant by keeping the `new URL(...)` inside the existing `try/catch` in `getWorker` (it already is) and, if needed, guard it so a build that can't resolve the worker still produces a working `dist` (the Vite playground bundles the worker correctly regardless, which is where we verify the off-main-thread benefit). Report which path was taken.

```bash
bun run lint:fix && git add src/raster/raster.worker.ts src/raster/rasterize-worker.ts src/hooks/use-field-targets.ts
git commit -m "feat: off-main-thread worker rasterization with main-thread fallback"
```

---

## Task 7: Playground (onStats + stress) + docs

**Files:**
- Modify: `test/ui/src/app.tsx`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Playground — onStats overlay + density.** In `test/ui/src/app.tsx`:
  - Add `const [stats, setStats] = useState<{ backend: string; particles: number } | null>(null)` and pass `onStats={setStats}` to `<Dotimation>`.
  - Show the resolved backend + particle count in the overlay: change the overlay line to include `{stats ? \`${stats.backend} · ${stats.particles} dots\` : ''}` alongside the fps.
  - Add a `maxParticles` toggle button (e.g. cycle `undefined → 5000 → 20000`) passed as the `maxParticles` prop, to push/limit density and observe fps per tier. Keep the existing presets/buttons.

- [ ] **Step 2: README props.** In `README.md`, document the two new props: `maxParticles?: number` (cap the number of dots; trades fidelity for performance) and `onStats?: (stats) => void` (reports `{ backend, particles }` — useful to see which backend `'auto'` chose).

- [ ] **Step 3: CLAUDE.md.** Update the architecture notes: rasterization now runs in a Web Worker when safe (`src/raster/raster.worker.ts` + `rasterize-worker.ts`), gated by the pure `isWorkerSafe` (custom-font text stays main-thread), with a main-thread `rasterize` fallback; shared draw helpers live in `src/raster/draw.ts`. Note `maxParticles` (sampler cap) and `onStats` (resolved backend + count). Note the cross-tier premultiplied/snapped render parity.

- [ ] **Step 4: Full gate**

Run `bun run type-check && bun run lint && bun test && bun run build` — all green.

```bash
bun run lint:fix && git add test/ui/src/app.tsx README.md CLAUDE.md
git commit -m "docs: playground onStats/density + document maxParticles, onStats, worker raster"
```

- [ ] **Step 5: Playground verification (human)**

`bun run dev`: confirm the overlay shows the resolved backend + live count; `maxParticles` caps the dots and lifts fps; toggling tiers renders with parity (compare canvas2d/webgl2/webgpu — translucent fades and small-dot placement match); a custom-font text item still renders correctly (main-thread fallback); large content doesn't jank the main thread (worker path).

---

## Definition of done (P3)

- `bun run type-check && bun run lint && bun test && bun run build` all green (37 tests: +3 sampler cap, +3 isWorkerSafe... counting: 34 + 3 + 3 = 40 — confirm the exact count after Tasks 1 and 5).
- `maxParticles` caps dots; `onStats` reports backend + count; the three tiers render with parity; rasterization runs off-main-thread when safe with a working fallback and correct custom-font handling.
- Public API additions are optional and backward compatible.

## Self-review notes (done while writing)

- **Spec coverage:** maxParticles (T1/T2), parity nits (T3), onStats + harness (T4/T7), worker raster with isWorkerSafe + fallback + shared draw (T5/T6/T7). WebGPU device-loss recovery intentionally out of scope.
- **Type consistency:** `sampleTargets(..., rand?, maxParticles?)` and `rasterize(..., maxParticles?)` add trailing optional params (existing callers unaffected); `selectBackend` now returns `{ backend, kind }` (the only caller — the component — is updated in T4); `DotimationStats`, `isWorkerSafe(item, defaultFontFamily)`, `rasterizeViaWorker(...)` signatures match across tasks.
- **Risk note:** the worker (T6) is the only fragile piece; it is gated by `workerRasterAvailable()` + `isWorkerSafe` and every failure path (`getWorker` try/catch, `onerror`, per-request `.catch`) falls back to main-thread `rasterize`, so it can only ever speed things up. The premultiplied blend change (T3) is the one with a visible-by-eye risk — verified against canvas2d in the playground.
