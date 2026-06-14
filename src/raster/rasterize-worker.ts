import type { AnimateItem, FieldTargets } from '@/types'
import { WORKER_SOURCE } from './worker-source'

interface Pending {
  resolve: (t: FieldTargets) => void
  reject: (e: unknown) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    // The worker is bundled to a self-contained string at build time and
    // instantiated from a Blob URL, so it ships inlined in the library and
    // works in any consumer regardless of their bundler's worker handling.
    const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
    )
    worker = new Worker(url, { type: 'module' })
    // The worker has its own reference to the resource now, so the object URL
    // can be released immediately instead of leaking for the page's lifetime.
    URL.revokeObjectURL(url)
    worker.onmessage = (e: MessageEvent): void => {
      const { id, targets, error } = e.data as {
        id: number
        targets?: FieldTargets
        error?: string
      }
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (error || !targets)
        p.reject(new Error(error ?? 'worker: empty result'))
      else p.resolve(targets)
    }
    worker.onerror = (): void => {
      for (const [, p] of pending) p.reject(new Error('worker: error'))
      pending.clear()
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

/** True only where a module worker + OffscreenCanvas exist. */
export function workerRasterAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

export function rasterizeViaWorker(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
  dpr: number,
): Promise<FieldTargets> {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('worker: unavailable'))
  const id = nextId++
  return new Promise<FieldTargets>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({
      id,
      item,
      width,
      height,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
      maxParticles,
      dpr,
    })
  })
}
