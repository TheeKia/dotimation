<script lang="ts">
  import { createDotimationController } from '@dotimation/core'
  import { untrack } from 'svelte'
  import type { DotimationProps } from './types'

  let {
    canvas = $bindable(),
    class: className,
    style,
    ...options
  }: DotimationProps = $props()
  let canvasKey = $state(0)
  const controller = createDotimationController({
    replaceCanvas: () => {
      canvasKey = untrack(() => canvasKey) + 1
    }
  })

  // Read nested options in the effect so Svelte tracks proxy property changes.
  // The runtime snapshots and compares those values before doing any work.
  $effect(() => {
    // An unrelated presentation update can retry a previously failed raster.
    void className
    void style
    const snapshot = {
      ...options,
      item: { ...options.item },
      dots: { ...options.dots },
      motion: { ...options.motion }
    }
    untrack(() => controller.update(snapshot))
  })

  function attach(element: HTMLCanvasElement): () => void {
    // Attachments run in their own effect; prop changes must update the current
    // session, not tear it down. The separate effect above owns prop tracking.
    return untrack(() => {
      controller.update(options)
      return controller.connect(element)
    })
  }
</script>

{#key canvasKey}
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role (This canvas displays an image and has no interactive behavior.) -->
  <canvas
    {@attach attach}
    bind:this={canvas}
    class={className}
    style={`${style ?? ''};width:${options.fill ? '100%' : `${options.width}px`};height:${options.fill ? '100%' : `${options.height}px`}`}
    role="img"
    aria-label={options.ariaLabel ??
      (options.item.type === 'text' ? options.item.data : undefined)}
  ></canvas>
{/key}
