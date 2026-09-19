import type { DotimationOptions, DotimationStats } from '@kiaa/dotimation-core'

/** A common browser driver; each adapter maps presentation/ref props natively. */
export type LifecycleProps = DotimationOptions & { className?: string }

export interface Lifecycle {
  render(next: Partial<LifecycleProps>): void
  mutateContent(text: string): void
  resize(width: number, height: number): void
  verifyRestore(): Promise<number>
  verifyGpu(kind: 'webgl2' | 'webgpu'): Promise<{
    initial: number
    grown: number
    duringFade: number
    afterFade: number
  }>
  unmount(): void
  updates: number
  stats: DotimationStats | null
  element: HTMLCanvasElement | null
}

declare global {
  interface Window {
    lifecycle: Lifecycle
  }
}
