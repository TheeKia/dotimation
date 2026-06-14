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

### Props

| Prop | Required | Default | Description |
|------|----------|---------|-------------|
| `item` | yes | — | `AnimateItem` — `{ type: 'text', data, fontSize?, fontFamily?, textColor? }` or `{ type: 'image', data, invert?, maxWidth?, maxHeight? }` |
| `width` | yes | — | Canvas width in CSS pixels |
| `height` | yes | — | Canvas height in CSS pixels |
| `defaultFontFamily` | no | `'sans-serif'` | Fallback font when `item.fontFamily` is not set |
| `alpha` | no | `128` | Minimum pixel alpha (0–255) for a pixel to become a dot |
| `pointSpacingCss` | no | `2` | Grid spacing (CSS px) between sampled dots — larger = fewer dots |
| `dotSize` | no | `1` | Radius multiplier for rendered dots |
| `backend` | no | `'auto'` | Rendering backend: `'auto' \| 'webgpu' \| 'webgl2' \| 'canvas2d'` |
| `idle` | no | `'sleep'` | `'sleep'` stops the rAF loop once particles settle; `'animate'` keeps looping |
| `maxParticles` | no | — | Cap the total number of dots (uniform random subset); trades fidelity for performance |
| `onStats` | no | — | `(stats: { backend: 'webgpu' \| 'webgl2' \| 'canvas2d'; particles: number }) => void` — fires on engine creation and each field update; reveals which backend `'auto'` resolved to and the live particle count |

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
