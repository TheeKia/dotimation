<script lang="ts">
  import { Dotimation } from '@dotimation/svelte'
  let text = $state('Packaged Svelte')
  let mounted = $state(true)
  if (typeof window !== 'undefined')
    Object.assign(window, {
      consumer: {
        render: (value: string) => {
          text = value
        },
        unmount: () => {
          mounted = false
        }
      }
    })
</script>

{#if mounted}
  <Dotimation
    item={{ type: 'text', data: text }}
    width={320}
    height={120}
    backend="canvas2d"
    reducedMotion
  />
{/if}
