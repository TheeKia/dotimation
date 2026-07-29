# dotimation

[![npm](https://img.shields.io/npm/v/dotimation)](https://www.npmjs.com/package/dotimation)
[![CI](https://github.com/TheeKia/dotimation/actions/workflows/ci.yml/badge.svg)](https://github.com/TheeKia/dotimation/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dotimation)](./LICENSE)

Animate anything with dots

## Installation

```bash
bun add dotimation
```

## Usage

```tsx
import { Dotimation } from 'dotimation'

function Component() {
  return (
    <Dotimation
      item={{ type: 'text', data: 'Hello' }}
      width={256}
      height={256}
      backend="auto"          // 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'
      motion={{ jitter: 0 }}  // calm/static once settled (see "Idle & performance")
    />
  )
}
```

Or let the component track its parent's size:

```tsx
<div style={{ width: '100%', height: 400 }}>
  <Dotimation item={{ type: 'text', data: 'Hello' }} fill />
</div>
```

### Props

| Prop | Required | Default | Description |
|------|----------|---------|-------------|
| `item` | yes | — | `AnimateItem` — `{ type: 'text', data, fontSize?, fontFamily?, textColor? }` or `{ type: 'image', data, invert?, maxWidth?, maxHeight? }` |
| `width` | yes* | — | Canvas width in CSS pixels (*omit both when using `fill`) |
| `height` | yes* | — | Canvas height in CSS pixels |
| `fill` | no | — | Size to the parent box instead of `width`/`height`, tracked live via `ResizeObserver` |
| `ref` | no | — | Ref to the underlying `<canvas>` element (React 19 ref-as-prop) |
| `ariaLabel` | no | text content | Accessible name for the canvas (rendered with `role="img"`); supply one for image items |
| `className` / `style` | no | — | Passed to the canvas (`style` excludes `width`/`height` — sizing is prop-driven) |
| `defaultFontFamily` | no | `'sans-serif'` | Fallback font when `item.fontFamily` is not set |
| `dots` | no | — | Dot field appearance/sampling — see [Dot field](#dot-field) |
| `motion` | no | — | Motion feel: shimmer, morph speed, damping, fade — see [Motion feel](#motion-feel) |
| `backend` | no | `'auto'` | Rendering backend: `'auto' \| 'webgpu' \| 'webgl2' \| 'canvas2d'` |
| `matching` | no | `'swarm'` | Particle-to-dot assignment on content change: `'swarm'` is a chaotic cloud, `'nearest'` pairs each particle with a nearby destination for a calmer, directed morph |
| `maxDpr` | no | `2` | Density cap for the canvas backing store; raise for full sharpness on 3× displays |
| `reducedMotion` | no | OS setting | Force reduced-motion behavior on/off; omit to follow `prefers-reduced-motion` |
| `onStats` | no | — | `(stats: { backend: 'webgpu' \| 'webgl2' \| 'canvas2d'; particles: number }) => void` — fires on engine creation and each field update; reveals which backend `'auto'` resolved to and the live particle count |

### Dot field

`dots` (type `DotOptions`, exported from the package root) controls sampling and appearance. Every field is optional; out-of-range input is sanitized silently — clamped to the nearest valid value (or the default, for non-finite input) rather than thrown.

| Field | Default | Description |
|-------|---------|--------------|
| `size` | `1` | Dot footprint in CSS px (scales with devicePixelRatio — same visual size at every density), or `'hairline'` for exactly 1 device pixel at any DPR (the crispest possible dots). Non-positive or non-finite numbers fall back to the default |
| `spacing` | `2` | Sampling grid step in CSS px; larger = fewer, sparser dots. Floored at `1` |
| `threshold` | `128` | Alpha cutoff (0–255) a source pixel must exceed to become a dot. Clamped to `[0, 255]` |
| `max` | unbounded | Cap on total particles (uniform random subset after sampling); trades fidelity for performance |

```tsx
<Dotimation
  item={{ type: 'text', data: 'Hello' }}
  width={256}
  height={256}
  dots={{ size: 1.5, spacing: 3, threshold: 100 }}
/>
```

### Motion feel

`motion` (type `MotionOptions`, exported from the package root) controls the spring physics driving each morph and the idle shimmer. Every field is optional and sanitized silently.

| Field | Default | Description |
|-------|---------|--------------|
| `jitter` | `1` | Shimmer amplitude in px per physics step; `0` disables it — particles go still once a morph settles. Clamped to `>= 0` |
| `settleTime` | `0.85` | Seconds for a morph to converge. Floored at `0.2` (integrator stability) |
| `damping` | `1` | Damping ratio: `1` = no overshoot, lower = bouncier. Clamped to `[0.3, 1]` |
| `fade` | `2` | Opacity ease rate per second for fade-in/out |

A few tuned starting points:

```tsx
// calm — gentle shimmer, slow, deliberate morphs
<Dotimation item={item} width={256} height={256} motion={{ jitter: 0.3, settleTime: 1.2 }} />

// snappy — default shimmer, fast morphs
<Dotimation item={item} width={256} height={256} motion={{ settleTime: 0.35 }} />

// bouncy — default shimmer/timing, springy overshoot
<Dotimation item={item} width={256} height={256} motion={{ damping: 0.5 }} />
```

### Idle & performance

There is no `idle` prop — the rAF loop's lifetime is derived from `motion.jitter`:

- **`jitter > 0`** (the default): the shimmer never converges, so the loop keeps running for as long as the canvas is on-screen — gated by an `IntersectionObserver`, so a scrolled-away instance costs ~0%, and background tabs are throttled by the browser like any other `requestAnimationFrame` loop.
- **`jitter === 0`** (or reduced motion, which forces it): the loop stops shortly after the field settles — ~0% idle CPU — and wakes again automatically on the next content, size, or motion change.

### Rendering backends

`backend="auto"` picks the best available tier — WebGPU (compute shader), then WebGL2 (transform feedback), then Canvas2D (always available). An explicit request pins the *starting* tier and keeps everything below it as fallback, so `backend="webgpu"` on a machine without WebGPU still gets WebGL2. All tiers render identically (same blending, device-pixel snapping, and dot sizing); `onStats` tells you which one is active.

### Accessibility

The canvas renders with `role="img"`. Text items get an accessible name from their content automatically; pass `ariaLabel` for image items (or to override). The component honors `prefers-reduced-motion` out of the box: morphs complete instantly and the idle shimmer is disabled, so content changes become short opacity fades with no movement. Use the `reducedMotion` prop to wire it to your app's own motion setting instead.

### Web fonts

Text using a custom `fontFamily` that hasn't finished loading is rasterized with fallback metrics first, then automatically re-rasterized once the font arrives — no wiring needed.

### Migrating from 0.6

0.7 groups the flat tuning props into `dots` and `motion`, and removes `idle`/`canvasRef`:

| 0.6 | 0.7 |
| --- | --- |
| `dotSize={1.5}` | `dots={{ size: 1.5 }}` |
| `pointSpacingCss={2}` | `dots={{ spacing: 2 }}` |
| `alpha={128}` | `dots={{ threshold: 128 }}` |
| `maxParticles={20000}` | `dots={{ max: 20000 }}` |
| `idle="sleep"` (freeze after settle) | `motion={{ jitter: 0 }}` (calm/static) |
| `idle="animate"` | default behavior — remove the prop |
| `canvasRef={ref}` | `ref={ref}` |

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
