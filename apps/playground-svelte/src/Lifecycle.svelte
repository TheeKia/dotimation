<script lang="ts">
  import { Dotimation } from '@dotimation/svelte'
  import { gpuChecks } from '../../../test/fixtures/browser/gpu'
  import type { LifecycleProps } from '../../../test/fixtures/browser/lifecycle'

  let props = $state<LifecycleProps>({
    item: { type: 'text', data: 'Lifecycle' },
    fill: true,
    backend: 'canvas2d',
    motion: { jitter: 0 }
  })
  let canvas = $state<HTMLCanvasElement>()
  let mounted = $state(true)
  const host = document.getElementById('root')!
  window.lifecycle = {
    stats: null,
    updates: 0,
    get element() {
      return canvas ?? null
    },
    render(next) {
      props = { ...props, ...next } as LifecycleProps
    },
    mutateContent(text) {
      props.item.data = text
    },
    resize(width, height) {
      host.style.width = `${width}px`
      host.style.height = `${height}px`
    },
    ...gpuChecks,
    unmount() {
      mounted = false
    }
  }
</script>

{#if mounted}
  <Dotimation
    {...props}
    class={props.className}
    bind:canvas
    onStats={(stats) => {
      window.lifecycle.updates++
      window.lifecycle.stats = stats
    }}
  />
{/if}
