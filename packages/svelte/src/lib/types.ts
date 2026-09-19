import type { DotimationOptions } from '@dotimation/core'
import type { ClassValue } from 'svelte/elements'

export type DotimationProps = DotimationOptions & {
  class?: ClassValue
  /** Inline CSS; width and height are controlled by the sizing options. */
  style?: string
  /** Bind with bind:canvas to observe the current element across replacements. */
  canvas?: HTMLCanvasElement
}
