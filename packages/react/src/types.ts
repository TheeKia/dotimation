import type { DotimationOptions } from '@dotimation/core'
import type { CSSProperties, Ref } from 'react'

export type DotimationProps = DotimationOptions & {
  /** React 19 ref to the current canvas, including after backend fallback. */
  ref?: Ref<HTMLCanvasElement>
  className?: string
  style?: Omit<CSSProperties, 'width' | 'height'>
}
