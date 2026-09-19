# @dotimation/svelte

Animate text and images with dots in Svelte 5.29+.

```sh
bun add @dotimation/svelte
```

```svelte
<script lang="ts">
  import { Dotimation } from '@dotimation/svelte'
  let text = $state('Hello Svelte')
  let canvas = $state<HTMLCanvasElement>()
</script>

<Dotimation
  item={{ type: 'text', data: text }}
  width={320}
  height={120}
  motion={{ jitter: 0 }}
  class="dots"
  bind:canvas
/>
```

Use `fill` instead of width/height inside a container with a defined height. `class` accepts Svelte class values; `style` accepts a CSS string. Sizing props control width and height. `bind:canvas` follows element replacements and clears on unmount. Server rendering reserves space; animation starts after mounting.

Content, dots, motion, backend, matching, reduced-motion and stats options match the React component. The shared `@dotimation/core` dependency is installed automatically; React is not required.

See the [shared API documentation](https://github.com/TheeKia/dotimation#shared-api).

MIT
