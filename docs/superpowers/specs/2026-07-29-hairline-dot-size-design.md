# `size: 'hairline'` — reliable 1-device-pixel dots

**Date:** 2026-07-29
**Status:** Approved (brainstorm w/ user)
**Release:** minor (additive, non-breaking)

## Motivation

Since `dotSize` became CSS-px on all tiers (commit `9561033`, shipped in 0.7.0),
the dot footprint is `max(1, round(size * dpr))` device pixels. On a DPR-2
display, `size: 1` renders a 2×2 device-pixel dot — there is no reliable way to
express the pre-0.7.0 hairline look ("exactly 1 device pixel"):

- `size: 0.5` happens to work only while the effective DPR ≤ 2 (the default
  `maxDpr` cap); at DPR 3 it rounds to 2 device px. Magic number.
- App-side `size: 1 / devicePixelRatio` breaks under SSR (no `window`), goes
  stale on live DPR changes (zoom, monitor moves — the library tracks these via
  `dprEpoch`, app code doesn't), and ignores the `maxDpr` cap
  (`dpr = min(devicePixelRatio, maxDpr)`), so it must replicate internal math
  to be correct.

## Public API (additive)

```ts
interface DotOptions {
  /** Dot footprint in CSS px, or 'hairline' for exactly 1 device pixel at any DPR. @default 1 */
  size?: number | 'hairline'
  // spacing / threshold / max unchanged
}
```

`dots={{ size: 'hairline' }}` renders every dot as exactly one device pixel on
every backend tier, at every DPR, regardless of `maxDpr`.

## Design

**Resolution only — no backend, shader, or engine changes.**

- `resolveDots` maps the literal `'hairline'` to a resolved `size: 0`.
  `ResolvedDots.size` stays `number`, so every downstream consumer is
  untouched: `toSimParams(m, d.size, reduced)`, the live-params effect deps
  (`d.size` stays a primitive), `SimParams.dotSize`, and `Backend.setParams`.
  (`size` does not feed `useFieldTargets` — raster inputs are
  `threshold`/`spacing`/`max` — so no re-rasterization concerns.)
- `0` is a safe internal sentinel:
  - It is unreachable today — numeric `size: 0` fails the `size > 0` check and
    falls back to the default, and that behavior is kept (only the literal
    string produces the sentinel).
  - The cross-tier parity contract already floors it: all three backends derive
    the footprint as `max(1, round(dotSize * dpr))` — canvas2d
    (`src/backends/canvas2d/render.ts`), webgl2
    (`src/backends/webgl2/shaders/draw.vert.ts`), webgpu
    (`src/backends/webgpu/shaders/draw.wgsl.ts`) — so `dotSize: 0` yields
    exactly 1 device pixel on every tier with zero changes. `computeDirtyRect`
    uses the same formula, so dirty-rect clears stay correct.
- A comment in `params.ts` pins the invariant: the `0` sentinel relies on the
  `max(1, …)` floor being the documented tier-parity contract (CLAUDE.md
  "Cross-tier parity").
- Sanitization convention holds (degrade, never throw): TypeScript rejects
  other strings; at runtime (JS consumers) any non-`'hairline'` string fails
  `num()`'s `typeof v === 'number'` check and falls back to the default.

## Testing

- `test/engine/params.test.ts`:
  - `resolveDots({ size: 'hairline' }).size === 0`
  - numeric `size: 0` still falls back to the default (sentinel not reachable
    by number)
  - `toSimParams` passes the `0` through to `SimParams.dotSize`
- `test/backends/canvas2d/render.test.ts`: `dotSize: 0` renders a
  1-device-pixel footprint at dpr 1 and dpr 2 (pins the floor the sentinel
  relies on).
- GPU tiers: playground verification (no headless GL/WebGPU) — the shader
  formula is the same `max(1.0, floor(dotSize * dpr + 0.5))` math.
- Playground (`test/ui`): add `'hairline'` to the dot-size control so the GPU
  tiers can be eyeballed.

## Docs

- README `dots` table, `size` row: document `'hairline'`.
- JSDoc on `DotOptions.size` (shown above).
