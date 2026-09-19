# dotimation

Animate text and images with dots in React 19.

```sh
bun add dotimation
```

```tsx
import { Dotimation } from 'dotimation'

<Dotimation
  item={{ type: 'text', data: 'Hello' }}
  width={320}
  height={120}
  motion={{ jitter: 0 }}
/>
```

Use `fill` instead of width/height inside a container with a defined height. `ref` exposes the current canvas; `className` and `style` control presentation. CSS width and height are controlled by the sizing props. Server rendering reserves space; animation starts after mounting.

Canvas2D, WebGL2 and WebGPU backends share the same behavior through `@dotimation/core`, installed automatically. The component honors reduced motion, loads custom fonts, and updates live without restarting for ordinary content/motion changes.

See the [full API documentation](https://github.com/TheeKia/dotimation#shared-api). For Svelte, use [`@dotimation/svelte`](https://github.com/TheeKia/dotimation#svelte-usage).

MIT
