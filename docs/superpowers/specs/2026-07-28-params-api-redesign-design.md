# Params API redesign: grouped `dots` + `motion`, derived idle policy

**Date:** 2026-07-28
**Status:** Approved (brainstorm w/ user)
**Release:** 0.7.0 (breaking; pre-1.0 clean break, no deprecation aliases)

## Goal

Replace the flat tuning props with two grouped, fully-optional config objects —
`dots` (what the field looks like / how it samples) and `motion` (how it moves) —
and expose the previously hardcoded motion constants (jitter, settle time,
damping, fade rate) as user knobs. Remove the `idle` prop entirely: loop policy
is derived from the effective jitter. No performance regressions: every motion
knob applies live (no engine recreation), and the hot loops gain zero new work.

## Public API (breaking)

```tsx
<Dotimation
  item={{ type: 'text', data: 'hi' }}
  fill
  dots={{
    size: 1.5,       // was dotSize        — CSS px, default 1
    spacing: 2,      // was pointSpacingCss — sampling grid step (CSS px), default 2
    threshold: 128,  // was alpha          — 0-255 alpha sampling cutoff, default 128
    max: 20000,      // was maxParticles   — particle cap, default unbounded
  }}
  motion={{
    jitter: 0.5,     // px shimmer amplitude per step, 0 = off, default 1
    settleTime: 0.6, // seconds for a morph to converge, default 0.85
    damping: 1,      // 1 = critically damped (no overshoot), <1 = bouncy, default 1
    fade: 2,         // opacity ease rate per second, default 2
  }}
/>
```

### Removed props / types

| Removed | Replacement |
| --- | --- |
| `dotSize` | `dots.size` |
| `pointSpacingCss` | `dots.spacing` |
| `alpha` | `dots.threshold` |
| `maxParticles` | `dots.max` |
| `idle` + exported `IdleBehavior` type | none — derived from `motion.jitter` (see below) |
| `canvasRef` (deprecated alias) | `ref` (React 19 ref-as-prop) |

### Unchanged props

`item`, `width`/`height`/`fill`, `backend`, `matching`, `maxDpr`,
`reducedMotion`, `defaultFontFamily`, `ariaLabel`, `className`, `style`, `ref`,
`onStats`.

Both groups and every field are optional; defaults reproduce today's visuals
exactly. `<Dotimation item={...} fill />` behaves identically to 0.6 except the
shimmer no longer freezes after the settle window (see idle policy).

### New exported types

`DotOptions` and `MotionOptions` (the two prop group shapes) are exported from
the package root alongside the existing types.

## Derived idle policy (replaces `idle`)

Rationale: with the old default (`idle: 'sleep'`, jitter 1), the shimmer ran
for ~1.5 s after a change and then froze — the worst of both worlds. The knob
disappears and the engine infers policy from the **effective jitter**:

- **effective jitter > 0** → the field is meant to look alive: the loop runs
  continuously while the canvas is on-screen. The existing
  `IntersectionObserver` still stops it off-screen, and background tabs are
  rAF-throttled by the browser, so cost is bounded to visible animation.
- **effective jitter === 0** (user sets `motion.jitter: 0`, or reduced motion
  forces it) → nothing moves once a morph settles, so the existing settle/sleep
  machinery applies: the loop stops ~`computeSettleDuration(...)` after the last
  change, or as soon as the backend reports `settled()`. Idle CPU ~0%.

Effective jitter = `reducedMotion ? 0 : motion.jitter`. Accessibility always
wins. Crossing the 0 boundary live must work: 0→positive starts the loop (if
visible); positive→0 arms one settle window so an in-flight morph finishes
before sleeping. The backend `settled()` early-sleep check only applies on the
jitter === 0 path (with jitter > 0 the field never converges, by design).

Engine consequences: `setIdle` deleted; `IdleBehavior` deleted from
`src/types.ts`; the component's `idleRef` plumbing deleted.

## Param resolution (new pure core)

New module `src/engine/params.ts` — pure, unit-tested:

- `resolveDots(input?: DotOptions): ResolvedDots` — fills defaults, sanitizes:
  `size` (non-finite or ≤ 0 → default 1), `spacing` (non-finite → default 2;
  clamped to ≥ 1 — sub-pixel steps explode particle counts), `threshold`
  (non-finite → default 128; clamped to [0, 255]), `max` (NaN → unbounded;
  clamped to ≥ 0, floored).
- `resolveMotion(input?: MotionOptions): ResolvedMotion` — fills defaults,
  sanitizes: `jitter` (non-finite → default 1; clamped to ≥ 0), `settleTime`
  (non-finite or ≤ 0 → default 0.85; **floored at 0.2 s**), `damping`
  (non-finite → default 1; **clamped to [0.3, 1]** — `tuneSpring`'s 2%
  settling-time formula requires ζ ≤ 1, and the floor keeps the fixed-step
  integrator stable, see below), `fade` (non-finite or ≤ 0 → default 2).
- `toSimParams(motion: ResolvedMotion, dotSize: number, reduced: boolean): SimParams`
  — the single place `tuneSpring` is applied. Returns
  `{ dotSize, jitter, k, c, settleTime, opacityRate, colorRate }` with jitter
  zeroed when `reduced` (`settleTime` rides along so the engine can derive its
  settle duration from the same object). `colorRate` stays an internal
  constant (not user-exposed).

**Integrator-stability floors:** the spring is integrated with semi-implicit
Euler at 90 Hz (`FIXED_DT = 1/90`), stable roughly while `ωn·dt < 2` where
`ωn = 4/(ζ·settleTime)`. The floors (`settleTime ≥ 0.2`, `damping ≥ 0.3`) give
worst-case `ωn = 4/(0.3·0.2) ≈ 66.7` → `ωn·dt ≈ 0.74`, comfortably inside the
stable region with margin for the jitter forcing. A unit test steps a field at
the floor values for thousands of steps and asserts no NaN/divergence.

Out-of-range input is **sanitized silently** (documented in prop JSDoc), never
thrown — an animation library should degrade, not crash the host app.

`src/engine/constants.ts` is absorbed into `params.ts` as the `DEFAULT_MOTION` /
`DEFAULT_DOTS` / `COLOR_RATE` definitions and deleted; all former importers
(backends, engine, gpu-shared, simulate) consume `SimParams` instead of global
constants, which is what makes per-instance values possible. The three tiers
still cannot drift because they all consume the same `SimParams` object.

## Live-update contract

**No engine or backend recreation for any dots/motion change.**

- `dots.spacing` / `threshold` / `max` are raster inputs (they already were,
  under old names): a change re-rasterizes through the existing latest-wins
  path and lands as a normal reconcile.
- `dots.size` + all `motion` knobs flow through a new
  `Backend.setParams(params: SimParams)` which **replaces** `setDotSize` (one
  live-params path instead of accumulating setters). Per-frame cost is zero:
  - **canvas2d**: stores the params object; `stepField` already takes
    `k, c, jitter` as arguments and `simulate.ts` gains `opacityRate` /
    `colorRate` parameters (defaulted, tests stay deterministic).
  - **webgl2 / webgpu**: `k, c, jitter, opacityRate, colorRate` are already
    written as uniforms every step; they just read the live params object
    instead of construction-time consts.
- `Engine.setDotSize` / `Engine.setIdle` are replaced by
  `Engine.setParams(params: SimParams)`: forwards to the backend, recomputes
  the per-engine settle duration `computeSettleDuration(settleTime, opacityRate)`
  (currently a module-level constant — becomes per-engine state, which is why
  `settleTime` is part of `SimParams`), updates the continuous-loop flag from
  `jitter > 0`, and wakes/starts the loop appropriately.
- **GPU fader expiry**: `FADE_DURATION_MS` (gpu-shared) becomes
  `fadeDurationMs(opacityRate)`. Both GPU tiers compute expiry from the
  current live rate; a mid-fade rate change shifting expiry slightly is
  acceptable (faders are invisible by then — the +0.15 s margin absorbs it).
- The component keeps one `paramsRef` (replacing `dotSizeRef` + `idleRef`) so
  the async engine-creation effect can apply post-construction changes, same
  pattern as today. Engine recreation deps stay exactly
  `[backend, dprEpoch, reduced, maxDpr]`.
- Reduced-motion flips keep today's behavior (re-key canvas, recreate engine,
  snap morphs). Rare event; not worth special-casing now that jitter is live.

### Prop identity

`dots` / `motion` are resolved to primitives during render; every effect and
hook depends on the resolved **primitive fields**, never the object identity —
inline literals (`motion={{ jitter: 2 }}`) cause zero spurious work. This
extends the existing `sameRasterInputs` pattern; `RasterInputs` fields are
renamed to the new vocabulary (`threshold`, `spacing`, `max`).

## Internal renames (code quality)

The old names disappear internally too, so the codebase speaks one vocabulary:
`alpha` → `threshold` and `pointSpacingCss` → `spacing` through `RasterInputs`,
`useFieldTargets`, `rasterize`, `sampleTargets`, and the worker request
protocol (worker + main fallback regenerate together via
`scripts/build-worker.ts`; the worker source is generated, so no compat
concern). `FieldTargets`/`ParticleField` keep `alpha` where it genuinely means
opacity.

## Testing

- **Unit (pure cores):** `params.test.ts` — defaults, partial objects,
  every clamp rule, NaN/Infinity handling, `toSimParams` reduced-motion
  zeroing; integrator stability at the floors (thousands of steps, no
  NaN/divergence, converges); `simulate` with non-default `fade`
  (reaches alpha 1/0 at the expected rate); `computeSettleDuration` with
  non-default rates; `fadeDurationMs(rate)`; existing suites updated for
  renames.
- **E2E smoke (`test/e2e/smoke.e2e.ts`):** update to the new prop surface,
  plus: (a) with default motion (jitter > 0) pixels keep changing between
  samples after the settle window (loop stays alive); (b) with
  `motion={{ jitter: 0 }}` the canvas is stable after settle (sleep works);
  (c) a live `motion` change neither blanks the canvas nor recreates the
  engine (canvas element identity stable across the change).
- **Playground (`test/ui`):** migrate config/presets/inspector to the new
  props; add inspector controls for the four motion knobs (sliders) so feel
  changes are verifiable by hand across all three backends.

## Docs & release

- README: new props documented, 0.6 → 0.7 migration table, `idle` removal
  explained (and how to get each old behavior: old `sleep` ≈ `jitter: 0`,
  old `animate` = default).
- CLAUDE.md: sync the architecture notes (constants → params, Backend
  interface, engine loop policy, component props).
- Version 0.7.0 via the existing `bun run release` flow — run by the user, not
  automated here.

## Explicitly out of scope

- Motion presets (`'calm'` / `'lively'`) — possible later sugar on top of
  `MotionOptions`.
- Exposing `colorRate`.
- Y-axis jitter (the X-only shimmer is the established look).
- Removing engine recreation on reduced-motion flips.
