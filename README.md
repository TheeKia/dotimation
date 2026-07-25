# dotimation

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
      backend="auto"   // 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'
      idle="sleep"     // stop animating once particles settle
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
| `alpha` | no | `128` | Minimum pixel alpha (0–255) for a pixel to become a dot |
| `pointSpacingCss` | no | `2` | Grid spacing (CSS px) between sampled dots — larger = fewer dots |
| `dotSize` | no | `1` | Dot footprint in CSS px (a `dotSize`×`dotSize` square, scaled to device pixels — same visual size at every DPR) |
| `backend` | no | `'auto'` | Rendering backend: `'auto' \| 'webgpu' \| 'webgl2' \| 'canvas2d'` |
| `idle` | no | `'sleep'` | `'sleep'` stops the rAF loop once particles settle; `'animate'` keeps looping |
| `matching` | no | `'swarm'` | Particle-to-dot assignment on content change: `'swarm'` is a chaotic cloud, `'nearest'` pairs each particle with a nearby destination for a calmer, directed morph |
| `maxParticles` | no | — | Cap the total number of dots (uniform random subset); trades fidelity for performance |
| `maxDpr` | no | `2` | Density cap for the canvas backing store; raise for full sharpness on 3× displays |
| `reducedMotion` | no | OS setting | Force reduced-motion behavior on/off; omit to follow `prefers-reduced-motion` |
| `onStats` | no | — | `(stats: { backend: 'webgpu' \| 'webgl2' \| 'canvas2d'; particles: number }) => void` — fires on engine creation and each field update; reveals which backend `'auto'` resolved to and the live particle count |
| `canvasRef` | no | — | **Deprecated** — pass `ref` instead |

### Rendering backends

`backend="auto"` picks the best available tier — WebGPU (compute shader), then WebGL2 (transform feedback), then Canvas2D (always available). An explicit request pins the *starting* tier and keeps everything below it as fallback, so `backend="webgpu"` on a machine without WebGPU still gets WebGL2. All tiers render identically (same blending, device-pixel snapping, and dot sizing); `onStats` tells you which one is active.

### Accessibility

The canvas renders with `role="img"`. Text items get an accessible name from their content automatically; pass `ariaLabel` for image items (or to override). The component honors `prefers-reduced-motion` out of the box: morphs complete instantly and the idle shimmer is disabled, so content changes become short opacity fades with no movement. Use the `reducedMotion` prop to wire it to your app's own motion setting instead.

### Web fonts

Text using a custom `fontFamily` that hasn't finished loading is rasterized with fallback metrics first, then automatically re-rasterized once the font arrives — no wiring needed.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
